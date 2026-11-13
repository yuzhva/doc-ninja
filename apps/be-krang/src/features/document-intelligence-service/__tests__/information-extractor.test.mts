import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_EXTRACTOR_SCHEMA,
  InformationExtractor,
} from '../information-extractor.mjs';
import type { ExtractorConfig } from '../information-extractor.mjs';

/** The default preview (`summary`) of the first `word` found in `content`. */
const previewOf = (
  content: string,
  word: string,
  config: ExtractorConfig = DEFAULT_EXTRACTOR_SCHEMA.config,
): string | null | undefined => {
  const position = content.indexOf(word);
  assert.notEqual(position, -1, `"${word}" is in the content`);
  return InformationExtractor.extract(config, content, {
    searchQuery: word,
    foundInDocument: 'doc.txt',
    matchedText: word,
    position,
  }).extractedFieldById.summary;
};

/** A line of `chars` characters of filler words. */
const fillerLine = (chars: number, word = 'filler'): string =>
  Array.from({ length: Math.ceil(chars / (word.length + 1)) }, () => word)
    .join(' ')
    .slice(0, chars);

describe('InformationExtractor.extract()', () => {
  it('previews the blank-line paragraph a match is in', () => {
    const content = [
      'First paragraph.',
      'Second paragraph line one,\nline two with the needle,\nline three.',
      'Third paragraph.',
    ].join('\n\n');

    assert.equal(
      previewOf(content, 'needle'),
      'line two with the needle,\nline three.',
    );
  });

  it('splits a document without blank lines at its line breaks', () => {
    // Every paragraph on a line of its own, no blank line between them: as
    // text exported from .doc/.docx is. Long enough not to be one paragraph.
    const lines = Array.from(
      { length: 200 },
      (_, index) => `Article ${index}. ${fillerLine(100)}`,
    );
    lines[120] = 'Article 120. The fine is set here.';
    const content = lines.join('\n');

    assert.equal(
      previewOf(content, 'fine'),
      'Article 120. The fine is set here.',
    );
  });

  it('keeps a document without blank lines whole while short enough', () => {
    const content = 'Line one.\nLine two with the needle.\nLine three.';
    assert.equal(
      previewOf(content, 'needle'),
      'Line two with the needle.\nLine three.',
    );
  });

  it('cuts a line with no line breaks around the match', () => {
    const content = `${fillerLine(50_000)} needle ${fillerLine(50_000)}`;
    const preview = previewOf(content, 'needle')!;

    assert.ok(preview.length <= 10_000 + 4, `${preview.length} chars`);
    assert.ok(preview.includes('needle'));
    assert.ok(preview.startsWith('… ') && preview.endsWith(' …'));
    // Cut on whitespace, never mid-word
    assert.match(preview, /^… filler /);
    assert.match(preview, / filler …$/);
  });

  it('caps a rule reading to the end of the document', () => {
    const content = Array.from({ length: 1_000 }, (_, index) =>
      index === 10 ? 'needle' : fillerLine(80),
    ).join('\n\n');
    const config: ExtractorConfig = {
      pipelines: [{ id: 'rest', unit: 'PARAGRAPH', limit: 'ULTIMATE' }],
      compounds: [{ id: 'summary', value: ['{{rest}}'] }],
    };

    const preview = previewOf(content, 'needle', config)!;
    assert.ok(preview.startsWith('needle'));
    assert.ok(preview.length <= 10_000 + 2, `${preview.length} chars`);
  });

  it('gives the same result with a units cache shared across matches', () => {
    const content = Array.from(
      { length: 300 },
      (_, index) => `Line ${index} ${fillerLine(60)}`,
    ).join('\n');
    const unitsCache = new Map();

    for (const position of [0, 5_000, 12_345, content.length - 1]) {
      const input = {
        searchQuery: 'x',
        foundInDocument: 'doc.txt',
        matchedText: 'x',
        position,
      };
      const config = DEFAULT_EXTRACTOR_SCHEMA.config;
      assert.deepEqual(
        InformationExtractor.extract(config, content, input, unitsCache),
        InformationExtractor.extract(config, content, input),
      );
    }
  });
});
