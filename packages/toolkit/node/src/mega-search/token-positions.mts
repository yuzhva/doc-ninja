/**
 * Where each token of a document is, in text order: its index in the
 * document's vocab and the characters it spans in the text. Three numbers a
 * token, in one typed array — an array per token took about six times the
 * memory, and an engine kept between requests holds every document a search
 * has read. Saved as one flat array of numbers (toJSON, fromFlat).
 */
class TokenPositions {
  static readonly EMPTY = new TokenPositions(new Uint32Array(0));

  /** @param data vocabIndex, charStart, charEnd of each token in turn */
  private constructor(private readonly data: Uint32Array) {}

  /** From vocabIndex, charStart, charEnd of each token in turn, as toJSON() gives. */
  static fromFlat(values: ArrayLike<number> | undefined): TokenPositions {
    if (!values || values.length === 0) return TokenPositions.EMPTY;
    if (values.length % 3 !== 0) {
      throw new Error(`Token positions come in threes, not ${values.length}`);
    }
    return new TokenPositions(Uint32Array.from(values));
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

  /** As saved: vocabIndex, charStart, charEnd of each token in turn. */
  toJSON(): number[] {
    return Array.from(this.data);
  }
}

export { TokenPositions };
