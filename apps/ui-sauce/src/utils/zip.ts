const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const concatUint8Arrays = (chunks: Uint8Array[]): Uint8Array => {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
};

const runThroughStream = async (
  stream: CompressionStream | DecompressionStream,
  bytes: Uint8Array,
): Promise<Uint8Array> => {
  const writer = stream.writable.getWriter();
  // TS's DOM lib expects a Uint8Array<ArrayBuffer> here; ours is always
  // backed by a real ArrayBuffer at runtime, this is a type-only mismatch.
  const writeDone = writer.write(bytes as any).then(() => writer.close());
  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();

  let result = await reader.read();
  while (!result.done) {
    chunks.push(result.value);
    result = await reader.read();
  }
  await writeDone;

  return concatUint8Arrays(chunks);
};

// ZIP's inner entry compression is raw DEFLATE (no zlib header/trailer),
// which is exactly what the 'deflate-raw' stream format produces/consumes.
const deflateRaw = (bytes: Uint8Array): Promise<Uint8Array> =>
  runThroughStream(new CompressionStream('deflate-raw'), bytes);

const inflateRaw = (bytes: Uint8Array): Promise<Uint8Array> =>
  runThroughStream(new DecompressionStream('deflate-raw'), bytes);

interface ZipWriteEntry {
  name: string;
  data: Uint8Array;
}

/**
 * Minimal ZIP reader. Assumes no encryption, no ZIP64, no multi-disk
 * archives — true for every .docx/.docm produced by Word or LibreOffice.
 */
async function unzip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const EOCD_SIGNATURE = 0x06054b50;
  const EOCD_MIN_SIZE = 22;
  let eocdOffset = -1;
  for (let i = bytes.length - EOCD_MIN_SIZE; i >= 0; i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error(
      'Not a valid zip file: End Of Central Directory record not found',
    );
  }

  const centralDirCount = view.getUint16(eocdOffset + 10, true);
  const centralDirOffset = view.getUint32(eocdOffset + 16, true);

  const CENTRAL_DIR_SIGNATURE = 0x02014b50;
  const LOCAL_HEADER_SIGNATURE = 0x04034b50;
  const decoder = new TextDecoder('utf-8');

  const entries = new Map<string, Uint8Array>();
  let offset = centralDirOffset;

  for (let i = 0; i < centralDirCount; i++) {
    if (view.getUint32(offset, true) !== CENTRAL_DIR_SIGNATURE) {
      throw new Error('Corrupt zip: central directory signature mismatch');
    }

    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(
      bytes.subarray(offset + 46, offset + 46 + nameLength),
    );

    if (view.getUint32(localHeaderOffset, true) !== LOCAL_HEADER_SIGNATURE) {
      throw new Error(
        `Corrupt zip: local header signature mismatch for ${name}`,
      );
    }
    const localNameLength = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
    const dataStart =
      localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressedData = bytes.subarray(
      dataStart,
      dataStart + compressedSize,
    );

    if (!name.endsWith('/')) {
      const data =
        compressionMethod === 8
          ? await inflateRaw(compressedData)
          : compressedData.slice();
      entries.set(name, data);
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

/**
 * Minimal ZIP writer. Always deflates entries and skips ZIP64 — fine for
 * documents in the realistic size range for a .docx/.docm template.
 */
async function zip(entries: ZipWriteEntry[]): Promise<Uint8Array> {
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  const encoder = new TextEncoder();
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const compressed = await deflateRaw(entry.data);
    const localOffset = offset;

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0, true);
    lv.setUint16(8, 8, true);
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, compressed.length, true);
    lv.setUint32(22, entry.data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    localChunks.push(localHeader, compressed);
    offset += localHeader.length + compressed.length;

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 8, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, compressed.length, true);
    cv.setUint32(24, entry.data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, localOffset, true);
    centralHeader.set(nameBytes, 46);
    centralChunks.push(centralHeader);
  }

  const centralDirBytes = concatUint8Arrays(centralChunks);
  const centralDirOffset = offset;
  offset += centralDirBytes.length;

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralDirBytes.length, true);
  ev.setUint32(16, centralDirOffset, true);
  ev.setUint16(20, 0, true);

  return concatUint8Arrays([...localChunks, centralDirBytes, eocd]);
}

export { unzip, zip };
export type { ZipWriteEntry };
