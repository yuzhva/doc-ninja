import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import { BM25Scorer } from '../bm25-scorer.mjs';
import type { BM25Config } from '../bm25-scorer.mjs';
import type { DocumentIndex } from '../types.mjs';

/** A scorer primed with a corpus of the given document lengths (word counts). */
const scorerFor = (config: BM25Config, ...wordCounts: number[]) => {
  const scorer = new BM25Scorer(config);
  const corpus = new Map(
    wordCounts.map((wordCount, i) => [
      `doc-${i}`,
      { wordCount } as DocumentIndex,
    ]),
  );
  // calculateAverageDocLength() logs the average — keep the test output clean
  const log = mock.method(console, 'log', () => {});
  try {
    scorer.calculateAverageDocLength(corpus);
  } finally {
    log.mock.restore();
  }
  return scorer;
};

const assertClose = (actual: number, expected: number) =>
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `expected ${actual} to be ≈ ${expected}`,
  );

describe('BM25Scorer', () => {
  const scorer = scorerFor({ k1: 1.2, b: 0.75 }, 10, 20, 30); // avgdl = 20

  describe('calculateScore()', () => {
    it('computes the Okapi BM25 term score', () => {
      // tf=2, |D|=avgdl=20, df=1, N=3:
      //   idf = ln(1 + (3 - 1 + 0.5) / (1 + 0.5)) = ln(8/3)
      //   tf part = 2 * 2.2 / (2 + 1.2 * (0.25 + 0.75 * 1)) = 4.4 / 3.2
      assertClose(scorer.calculateScore(2, 20, 1, 3), Math.log(8 / 3) * 1.375);
    });

    it('rewards repeated terms with diminishing returns, capped at idf * (k1 + 1)', () => {
      const score = (tf: number) => scorer.calculateScore(tf, 20, 1, 3);

      assert.ok(score(2) > score(1));
      assert.ok(score(2) - score(1) > score(3) - score(2));
      assert.ok(score(5000) < Math.log(8 / 3) * 2.2);
    });

    it('scores a term lower in a longer-than-average document', () => {
      assert.ok(
        scorer.calculateScore(1, 40, 1, 3) < scorer.calculateScore(1, 10, 1, 3),
      );
    });

    it('ignores document length when b = 0', () => {
      const noLengthNorm = scorerFor({ k1: 1.2, b: 0 }, 10, 20, 30);

      assert.equal(
        noLengthNorm.calculateScore(1, 1000, 1, 3),
        noLengthNorm.calculateScore(1, 1, 1, 3),
      );
    });

    it('keeps scores positive for terms that appear in most documents', () => {
      // Regression guard: the classic idf ln((N - df + 0.5) / (df + 0.5)) is
      // ≤ 0 once df ≥ N/2, so common words scored 0 or less and inverted the
      // ranking (more occurrences → lower score). Lucene's ln(1 + …) is not.
      // a word present in 2 of 3 documents: idf = ln(1 + 1.5 / 2.5)
      assertClose(scorer.calculateScore(1, 20, 2, 3), Math.log(1.6));
      assert.ok(
        scorer.calculateScore(3, 20, 2, 3) > scorer.calculateScore(1, 20, 2, 3),
      );
      // and a word in every document still counts for something
      assert.ok(scorer.calculateScore(1, 20, 3, 3) > 0);
    });

    it('still weighs a rare term above a common one', () => {
      assert.ok(
        scorer.calculateScore(1, 20, 1, 3) > scorer.calculateScore(1, 20, 2, 3),
      );
      assert.ok(
        scorer.calculateScore(1, 20, 2, 3) > scorer.calculateScore(1, 20, 3, 3),
      );
    });
  });

  describe('calculateTfIdfScore()', () => {
    it('multiplies raw tf by a smoothed, always-positive idf', () => {
      // 3 * (ln((3 + 1) / (1 + 1)) + 1)
      assertClose(scorer.calculateTfIdfScore(3, 1, 3), 3 * (Math.log(2) + 1));
      assert.ok(scorer.calculateTfIdfScore(1, 3, 3) > 0);
    });
  });

  describe('calculateAverageDocLength()', () => {
    it('normalizes by the corpus average word count', () => {
      // a document exactly as long as the average gets length factor 1:
      // tf part = 1 * 2.2 / (1 + 1.2) = 1
      assertClose(scorer.calculateScore(1, 20, 1, 3), Math.log(8 / 3));
    });
  });

  it('describes its parameters for logging', () => {
    assert.equal(scorer.getScoringMethod(), 'BM25(k1=1.2, b=0.75)');
  });
});
