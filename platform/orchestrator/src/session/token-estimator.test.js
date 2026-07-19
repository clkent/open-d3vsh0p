const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { TokenEstimator } = require('./token-estimator');

describe('TokenEstimator (stub)', () => {
  it('initializes with zero sessions', async () => {
    const estimator = new TokenEstimator('/tmp/nowhere');
    await estimator.init();
    assert.equal(estimator.sessionCount, 0);
  });

  it('returns null estimate so callers skip the display', async () => {
    const estimator = new TokenEstimator('/tmp/nowhere');
    await estimator.init();
    assert.equal(estimator.estimateRemaining(5), null);
    assert.equal(estimator.estimateRemaining(0), null);
  });
});
