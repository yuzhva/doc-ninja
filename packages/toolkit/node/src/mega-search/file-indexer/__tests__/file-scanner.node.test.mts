import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { createTempCorpus } from '../../test-utils/temp-corpus.mjs';
import type { TempCorpus } from '../../test-utils/temp-corpus.mjs';
import { FileScannerNode } from '../file-scanner.node.mjs';

describe('FileScannerNode', () => {
  let corpus: TempCorpus;

  before(async () => {
    corpus = await createTempCorpus({
      'a.txt': 'текст',
      'nested/deep/b.TXT': 'текст',
      'report.docx': 'бінарний вміст',
      '.hidden.txt': 'прихований',
      '.git/config.txt': 'службовий',
      '~$lock.docx': 'файл блокування Office',
      'empty.txt': '',
      'big.txt': 'x'.repeat(2048),
      'build/out.txt': 'артефакт',
      'search-cache/txt/a.txt.txt': 'кеш',
      'nested/search-cache/kept.txt': 'не кеш',
    });
  });

  after(() => corpus.cleanup());

  const scannedPaths = async (
    options: Parameters<typeof FileScannerNode.scanDirectory>[1] = {},
  ) =>
    (await FileScannerNode.scanDirectory(corpus.root, options))
      .map((item) => item.path)
      .sort();

  describe('scanDirectory()', () => {
    it('lists files recursively with root-relative POSIX paths and file metadata', async () => {
      const items = await FileScannerNode.scanDirectory(corpus.root, {
        extensions: ['.txt'],
      });
      const nested = items.find((item) => item.name === 'b.TXT')!;

      assert.equal(nested.path, 'nested/deep/b.TXT');
      assert.equal(nested.fsItemType, 'file');
      assert.equal(nested.extension, 'TXT');
      assert.equal(nested.size, Buffer.byteLength('текст'));
      assert.ok(nested.modifiedAt instanceof Date);
    });

    it('filters by extension, case-insensitively', async () => {
      assert.deepEqual(await scannedPaths({ extensions: ['.docx'] }), [
        'report.docx',
      ]);
      assert.ok(
        (await scannedPaths({ extensions: ['.txt'] })).includes(
          'nested/deep/b.TXT',
        ),
      );
    });

    it('skips hidden entries, Office lock files and empty files', async () => {
      const paths = await scannedPaths();

      for (const skipped of [
        '.hidden.txt',
        '.git/config.txt',
        '~$lock.docx',
        'empty.txt',
      ]) {
        assert.ok(!paths.includes(skipped), `${skipped} should be skipped`);
      }
    });

    it('skips files above maxFileSize', async () => {
      assert.ok(
        !(await scannedPaths({ maxFileSize: 1024 })).includes('big.txt'),
      );
      assert.ok((await scannedPaths()).includes('big.txt'));
    });

    it('excludes directories by name at any depth, but by absolute path only where pointed', async () => {
      const paths = await scannedPaths({
        excludeDirs: ['build'],
        excludeAbsoluteDirs: [corpus.pathOf('search-cache')],
      });

      assert.ok(!paths.includes('build/out.txt'));
      assert.ok(!paths.includes('search-cache/txt/a.txt.txt'));
      assert.ok(paths.includes('nested/search-cache/kept.txt'));
    });

    it('returns an empty list for a missing directory instead of throwing', async () => {
      assert.deepEqual(
        await FileScannerNode.scanDirectory(corpus.pathOf('missing')),
        [],
      );
    });
  });

  describe('safeReadFile()', () => {
    it('reads a file into a Buffer', async () => {
      const buffer = await FileScannerNode.safeReadFile(corpus.pathOf('a.txt'));

      assert.ok(Buffer.isBuffer(buffer));
      assert.equal(buffer.toString('utf8'), 'текст');
    });

    it('rejects with the file name for an unreadable path', async () => {
      await assert.rejects(
        FileScannerNode.safeReadFile(corpus.pathOf('missing.txt')),
        /^Error: Cannot read file missing\.txt:/,
      );
    });
  });
});
