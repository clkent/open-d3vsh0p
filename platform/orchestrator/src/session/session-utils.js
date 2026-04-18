/**
 * Generate a timestamp-based session ID.
 * @param {string} [prefix] — optional prefix (e.g., 'pair', 'plan', 'kickoff')
 * @returns {string} — e.g., '2026-02-17-14-30' or 'pair-2026-02-17-14-30'
 */
function generateSessionId(prefix) {
  const timestamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
  return prefix ? `${prefix}-${timestamp}` : timestamp;
}

module.exports = { generateSessionId };
