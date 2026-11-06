/**
 * Test bootstrap, loaded through `--import` before any test file — and so
 * before the modules under test evaluate their module-level `createLogger()`
 * calls, which read LOG_LEVEL once at creation time.
 *
 * Mega-search logs every indexing and search step at INFO level; inside a
 * test run that buries the assertion output. Default to ERROR, but keep an
 * explicit LOG_LEVEL so `LOG_LEVEL=DEBUG pnpm test` still works for debugging.
 */
process.env.LOG_LEVEL ??= 'ERROR';

// `natural` loads dotenv on import, which prints an "injected env" banner
// several times per test process.
process.env.DOTENV_CONFIG_QUIET ??= 'true';
