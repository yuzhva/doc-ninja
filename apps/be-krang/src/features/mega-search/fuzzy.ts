/**
 * Calculates the Levenshtein distance between two strings.
 * Returns the number of edits (insertions, deletions, substitutions) required to transform a into b.
 */
function levenshtein(a: string, b: string): number {
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
    }
  }
  return dp[m][n];
}

/**
 * Returns true if the Levenshtein distance between a and b is less than or equal to threshold.
 */
function fuzzyMatch(a: string, b: string, threshold: number = 1): boolean {
  return levenshtein(a, b) <= threshold;
}

export { fuzzyMatch, levenshtein };
