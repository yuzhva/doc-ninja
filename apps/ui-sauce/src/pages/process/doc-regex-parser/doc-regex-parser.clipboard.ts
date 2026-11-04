// Plain tab-separated text — what Excel splits into cells on paste, and it
// then types the cells itself (so "11.12.2026" lands as a real date).
// Deliberately no HTML flavour: with one, Excel would take its formatting
// from the HTML instead.

/**
 * A tab or line break inside a value would start a new cell/row in Excel,
 * so whatever is left of them after normalisation is flattened to a space.
 */
const toClipboardCell = (value: string | null | undefined) =>
  (value ?? '').replace(/[\t\r\n]+/g, ' ').trim();

// \r\n is what Excel itself puts on the clipboard on Windows.
const buildClipboardText = (rows: Array<Array<string | null | undefined>>) =>
  rows.map((row) => row.map(toClipboardCell).join('\t')).join('\r\n');

export { buildClipboardText, toClipboardCell };
