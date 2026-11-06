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
 * 2. apostrophes: U+2019 and U+02BC inside words, none at their edges
 * 3. no hyphens at word edges ("інженера- конструктора" → "інженера", "конструктора")
 * 4. numbers: runs of digits are tokens ("22.12.2024" → 22, 12, 2024);
 *    wordCount counts words only
 * 5. joints: what glues a number to the token before or after it
 *    ("22.12.2024" → "." twice), so a glued query finds it as written
 * 6. positions saved flat, three numbers a token in one array
 *    ([vocabIndex, charStart, charEnd, …]), not an array per token
 * 7. every word indexed: no stop words left out; function words (see
 *    isFunctionWord) under themselves, not their stem, and out of the stem
 *    dictionary; wordCount counts neither numbers nor function words
 * 8. a word typed in both alphabets reads in the one most of its letters
 *    are in ("Мiнiстерство" with a Latin "i" → "міністерство")
 */
const INDEX_VERSION = 8;

export { INDEX_VERSION };
