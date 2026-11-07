/**
 * Where each token of a document is, in text order: its index in the
 * document's vocab and the characters it spans in the text. Three numbers a
 * token, in one typed array — an array per token took about six times the
 * memory, and an engine kept between requests holds every document a search
 * has read.
 *
 * Saved as one flat array of numbers, three a token: its vocab index, the
 * characters between it and the token before (from the text's start, for the
 * first), and its length (toJSON, fromSaved). Small numbers, where the
 * characters it starts and ends at grow with the text: on 362 documents, the
 * per-document indexes take 30 MB instead of 53, are written in half the
 * time and read in two thirds.
 */
class TokenPositions {
  static readonly EMPTY = new TokenPositions(new Uint32Array(0));

  /** @param data vocabIndex, charStart, charEnd of each token in turn */
  private constructor(private readonly data: Uint32Array) {}

  /** From vocabIndex, charStart, charEnd of each token in turn. */
  static fromFlat(values: ArrayLike<number> | undefined): TokenPositions {
    if (!values || values.length === 0) return TokenPositions.EMPTY;
    TokenPositions.checkThrees(values);
    return new TokenPositions(Uint32Array.from(values));
  }

  /** From vocabIndex, gap, length of each token in turn, as toJSON() gives. */
  static fromSaved(saved: ArrayLike<number> | undefined): TokenPositions {
    if (!saved || saved.length === 0) return TokenPositions.EMPTY;
    TokenPositions.checkThrees(saved);
    const data = new Uint32Array(saved.length);
    let previousEnd = 0;
    for (let i = 0; i < saved.length; i += 3) {
      data[i] = saved[i];
      data[i + 1] = previousEnd + saved[i + 1];
      data[i + 2] = previousEnd = data[i + 1] + saved[i + 2];
    }
    return new TokenPositions(data);
  }

  private static checkThrees(values: ArrayLike<number>): void {
    if (values.length % 3 !== 0) {
      throw new Error(`Token positions come in threes, not ${values.length}`);
    }
  }

  /** The number of tokens. */
  get length(): number {
    return this.data.length / 3;
  }

  vocabIndex(token: number): number {
    return this.data[token * 3];
  }

  charStart(token: number): number {
    return this.data[token * 3 + 1];
  }

  charEnd(token: number): number {
    return this.data[token * 3 + 2];
  }

  /** The token's [vocabIndex, charStart, charEnd]. */
  at(token: number): [number, number, number] {
    const i = token * 3;
    return [this.data[i], this.data[i + 1], this.data[i + 2]];
  }

  /** As saved: vocabIndex, gap, length of each token in turn (see fromSaved). */
  toJSON(): number[] {
    const saved = new Array<number>(this.data.length);
    let previousEnd = 0;
    for (let i = 0; i < this.data.length; i += 3) {
      saved[i] = this.data[i];
      saved[i + 1] = this.data[i + 1] - previousEnd;
      saved[i + 2] = this.data[i + 2] - this.data[i + 1];
      previousEnd = this.data[i + 2];
    }
    return saved;
  }
}

export { TokenPositions };
