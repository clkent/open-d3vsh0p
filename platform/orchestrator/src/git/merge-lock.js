/**
 * Async mutex for serializing git merge operations.
 *
 * Node.js is single-threaded, so we use a promise queue to ensure
 * only one merge operation runs at a time. This prevents git conflicts
 * when multiple parallel agents finish their work simultaneously.
 */
class MergeLock {
  constructor() {
    this._queue = [];
    this._locked = false;
  }

  /**
   * Acquire the lock. Returns a release function.
   * If the lock is already held, waits until it's available.
   */
  async acquire() {
    if (!this._locked) {
      this._locked = true;
      return () => this._release();
    }

    // Wait in queue
    return new Promise((resolve) => {
      this._queue.push(() => {
        resolve(() => this._release());
      });
    });
  }

  /**
   * Run a function while holding the lock.
   * Automatically releases the lock when done (even on error).
   */
  async withLock(fn) {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  _release() {
    if (this._queue.length > 0) {
      const next = this._queue.shift();
      next();
    } else {
      this._locked = false;
    }
  }

  get isLocked() {
    return this._locked;
  }

  get queueLength() {
    return this._queue.length;
  }
}

module.exports = { MergeLock };
