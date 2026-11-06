/**
 * The number of typos between two words: insertions, deletions,
 * substitutions and swaps of two adjacent letters, one edit each.
 *
 * This is the optimal string alignment (OSA) distance, Levenshtein plus
 * swaps: "serach" is 1 edit from "search", where Levenshtein counts 2. It
 * never edits a substring twice, so it can exceed the unrestricted
 * Damerau–Levenshtein distance ("ca" → "abc" is 3, not 2). Real typos never
 * need that.
 */
function editDistance(a: string, b: string): number {
  const m = a.length,
    n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
      }
    }
  }
  return dp[m][n];
}

/**
 * Returns true if a and b are at most threshold typos apart (see editDistance).
 */
function fuzzyMatch(a: string, b: string, threshold: number = 1): boolean {
  // Every edit changes the length by at most one (a swap not at all), so
  // this rules most pairs out without building the distance matrix.
  if (Math.abs(a.length - b.length) > threshold) return false;
  return editDistance(a, b) <= threshold;
}

export { editDistance, fuzzyMatch };
