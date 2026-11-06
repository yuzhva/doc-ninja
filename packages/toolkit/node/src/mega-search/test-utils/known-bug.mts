/**
 * Marks a test that asserts the *intended* behaviour of a defect which is
 * known but not fixed yet.
 *
 * node:test still runs the body, but reports it as TODO instead of failing
 * the suite. Once the bug is fixed the test starts passing — then drop the
 * marker so the test becomes a regular regression guard.
 *
 * @example
 * it('finds inflected words', knownBug('strict mode skips stemming'), () => {});
 */
function knownBug(description: string): { todo: string } {
  return { todo: `KNOWN BUG: ${description}` };
}

export { knownBug };
