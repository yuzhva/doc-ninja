/**
 * One copy of each word for all the documents of a folder. Each document
 * keeps the distinct words it has (its vocab), and a word read from its cache
 * file, or cut from its text, is a string of its own: a common word was held
 * once for every document it's in. Shared, the words of 7,000 documents took
 * 42 MB instead of 151 (real text: about a fifth less).
 *
 * The documents of one engine share them; words of documents gone since stay
 * until the cache is cleared or the engine let go.
 */
class SharedWords {
  private words = new Map<string, string>();

  /** The copy of `word` all documents share. */
  get(word: string): string {
    let shared = this.words.get(word);
    if (shared === undefined) {
      // A copy of its own: a word cut from a document's text can be a slice
      // of it, which would keep that whole text in memory as long as the word
      shared = Buffer.from(word, 'utf16le').toString('utf16le');
      this.words.set(shared, shared);
    }
    return shared;
  }

  /** Puts the shared copy of each word into `vocab` — in place, and returns it. */
  share(vocab: string[]): string[] {
    for (let i = 0; i < vocab.length; i++) vocab[i] = this.get(vocab[i]);
    return vocab;
  }

  clear(): void {
    this.words.clear();
  }
}

export { SharedWords };
