// Import this FIRST in every test file that touches app code: it must run before modules read process.env.
process.env.JWT_SECRET = "test-secret-test-secret-test-secret-123456";
process.env.ARCHIVE_DB_URL = ":memory:";
process.env.TRUST_PROXY = "true";
// The feed waits this long for an in-progress refresh before answering from the saved copy (default 4000)
process.env.FEED_SOFT_WAIT_MS = "150";

// The app logs JSON lines through console; keep test output readable unless debugging
if (!process.env.TEST_VERBOSE) {
  for (const level of ["log", "info", "warn", "error", "debug"]) console[level] = () => {};
}
