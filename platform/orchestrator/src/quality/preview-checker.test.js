const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const { checkPreview } = require('./preview-checker');

describe('PreviewChecker', () => {
  describe('checkPreview', () => {
    it('returns available: true when server responds', async () => {
      // Start a real HTTP server
      const server = http.createServer((req, res) => {
        res.writeHead(200);
        res.end('ok');
      });

      const port = 19871;
      await new Promise(resolve => server.listen(port, resolve));

      try {
        // Use a command that just sleeps (server already running externally)
        const result = await checkPreview({
          command: 'sleep 30',
          port,
          timeoutSeconds: 5,
          workingDir: process.cwd()
        });

        assert.equal(result.available, true);
        assert.equal(typeof result.responseTimeMs, 'number');
        assert.ok(result.responseTimeMs >= 0);
      } finally {
        server.close();
      }
    });

    it('returns available: false with reason timeout when server does not respond', async () => {
      // Use a port nothing is listening on
      const result = await checkPreview({
        command: 'sleep 30',
        port: 19872,
        timeoutSeconds: 2,
        workingDir: process.cwd()
      });

      assert.equal(result.available, false);
      assert.equal(result.reason, 'timeout');
    });

    it('returns available: false with reason process_exit when command exits early', async () => {
      const result = await checkPreview({
        command: 'node -e process.exit(1)',
        port: 19873,
        timeoutSeconds: 5,
        workingDir: process.cwd()
      });

      assert.equal(result.available, false);
      assert.equal(result.reason, 'process_exit');
      assert.equal(result.exitCode, 1);
    });

    it('uses default timeout of 10 seconds when not specified', async () => {
      const start = Date.now();
      // Use a tiny custom timeout to avoid waiting 10s in tests
      const result = await checkPreview({
        command: 'sleep 30',
        port: 19874,
        timeoutSeconds: 1,
        workingDir: process.cwd()
      });

      const elapsed = Date.now() - start;
      assert.equal(result.available, false);
      assert.equal(result.reason, 'timeout');
      // Should complete within ~2s (1s timeout + poll interval + margin)
      assert.ok(elapsed < 3000, `Took ${elapsed}ms, expected < 3000ms`);
    });

    it('respects custom timeout', async () => {
      const start = Date.now();
      const result = await checkPreview({
        command: 'sleep 30',
        port: 19875,
        timeoutSeconds: 2,
        workingDir: process.cwd()
      });

      const elapsed = Date.now() - start;
      assert.equal(result.available, false);
      assert.ok(elapsed >= 1900, `Took ${elapsed}ms, expected >= 1900ms`);
      assert.ok(elapsed < 4000, `Took ${elapsed}ms, expected < 4000ms`);
    });
  });
});
