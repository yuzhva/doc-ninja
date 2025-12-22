interface SliceOptions {
  buffer: Buffer;
  originalFileName?: string;
  sheetToChunkPosition?: number;
  headerRows?: number;
  splitColumnPosition?: number;
  maxColumnsToInclude?: number;
  filenameSuffix?: string;
  chunkNamePattern?: string;
  includeHiddenSheets?: boolean;
  additionalSheets?: Array<{
    sheetIndex: number;
    filterColumnPosition: number;
    headerRows?: number;
    maxColumnsToInclude?: number;
  }>;
}

interface ChunkFile {
  name: string;
  content: Buffer;
  relativePath: string;
}

export type { ChunkFile, SliceOptions };
