/**
 * Version of what the index holds: how text is tokenized, normalized and
 * stemmed into vocab, positions and postings.
 *
 * Bump it with every change that indexes the same text differently: the
 * tokenizer, normalization, function words, the stemmer. On the next start the
 * global index and every per-document index from another version are rebuilt.
 * The extracted-text cache is kept, so no document is parsed again.
 *
 * History:
 * 1. (unversioned) everything before versioning
 * 2.0. apostrophes: U+2019 and U+02BC inside words, none at their edges
 * 2.1. no hyphens at word edges ("інженера- конструктора" → "інженера", "конструктора")
 * 2.2. numbers: runs of digits are tokens ("22.12.2024" → 22, 12, 2024);
 *    wordCount counts words only
 * 2.3. joints: what glues a number to the token before or after it
 *    ("22.12.2024" → "." twice), so a glued query finds it as written
 * 2.4. positions saved flat, three numbers a token in one array
 *    ([vocabIndex, charStart, charEnd, …]), not an array per token
 * 2.5. every word indexed: no stop words left out; function words (see
 *    isFunctionWord) under themselves, not their stem, and out of the stem
 *    dictionary; wordCount counts neither numbers nor function words
 * 2.6. a word typed in both alphabets reads in the one most of its letters
 *    are in ("Мiнiстерство" with a Latin "i" → "міністерство")
 * 2.7. positions saved as [vocabIndex, gap, length] a token: the characters
 *    from the end of the token before, and its own, not where it starts and
 *    ends (see TokenPositions); no term frequencies, which nothing read
 * 2.8. documents' paths saved from the folder indexed, with "/" between names
 *    (relativeFilePath), and no textFilePath: a cache reads the same
 *    wherever the folder is (see SavedPaths)
 */
const INDEX_VERSION = 2;

export { INDEX_VERSION };
