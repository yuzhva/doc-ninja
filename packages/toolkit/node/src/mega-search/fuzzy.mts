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

// The rows fuzzyMatch() fills, kept for the next call: it runs for every
// word of the index a query word is checked against
let rows = [new Int32Array(32), new Int32Array(32), new Int32Array(32)];

/**
 * Returns true if a and b are at most threshold typos apart (see
 * editDistance). The same answer as `editDistance(a, b) <= threshold`, found
 * sooner when it's no — as it is for nearly every word a query word is
 * checked against: it stops at the first row of the matrix where every
 * cell is over the threshold. No later row has a lower cell (each cell
 * comes from cells of one or two rows up, plus an edit), so the last cell
 * is over it too.
 */
function fuzzyMatch(a: string, b: string, threshold: number = 1): boolean {
  // Every edit changes the length by at most one (a swap not at all), so
  // this rules most pairs out without filling any row.
  if (Math.abs(a.length - b.length) > threshold) return false;
  if (a === b) return true;

  const m = a.length,
    n = b.length;
  // One of them is empty, the other within the threshold in length
  if (m === 0 || n === 0) return true;
  if (rows[0].length <= n) {
    rows = [
      new Int32Array(n + 1),
      new Int32Array(n + 1),
      new Int32Array(n + 1),
    ];
  }

  // The row two up (for a swap), the row up, and the row being filled
  let [twoUp, up, row] = rows;
  for (let j = 0; j <= n; j++) up[j] = j;
  for (let i = 1; i <= m; i++) {
    row[0] = i;
    let rowMin = i;
    const letter = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      let cell = Math.min(
        up[j] + 1,
        row[j - 1] + 1,
        up[j - 1] + (letter === b.charCodeAt(j - 1) ? 0 : 1),
      );
      if (
        i > 1 &&
        j > 1 &&
        letter === b.charCodeAt(j - 2) &&
        a.charCodeAt(i - 2) === b.charCodeAt(j - 1)
      ) {
        cell = Math.min(cell, twoUp[j - 2] + 1);
      }
      row[j] = cell;
      if (cell < rowMin) rowMin = cell;
    }
    if (rowMin > threshold) return false;
    [twoUp, up, row] = [up, row, twoUp];
  }
  return up[n] <= threshold;
}

export { editDistance, fuzzyMatch };
