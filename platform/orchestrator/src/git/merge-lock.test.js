const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { MergeLock } = require('./merge-lock');

describe('MergeLock', () => {
  let lock;

  beforeEach(() => {
    lock = new MergeLock();
  });

  describe('acquire / release', () => {
    it('acquires immediately when unlocked', async () => {
      const release = await lock.acquire();
      assert.equal(typeof release, 'function');
      assert.equal(lock.isLocked, true);
      release();
    });

    it('sets isLocked to true after acquire', async () => {
      assert.equal(lock.isLocked, false);
      const release = await lock.acquire();
      assert.equal(lock.isLocked, true);
      release();
    });

    it('releases correctly and sets isLocked to false', async () => {
      const release = await lock.acquire();
      release();
      assert.equal(lock.isLocked, false);
    });
  });

  describe('mutual exclusion', () => {
    it('second acquire waits until first releases', async () => {
      const order = [];
      const release1 = await lock.acquire();
      order.push('acquired-1');

      const p2 = lock.acquire().then(release => {
        order.push('acquired-2');
        return release;
      });

      // Second acquire should not have resolved yet
      await new Promise(r => setTimeout(r, 10));
      assert.deepEqual(order, ['acquired-1']);

      release1();
      const release2 = await p2;
      assert.deepEqual(order, ['acquired-1', 'acquired-2']);
      release2();
    });

    it('maintains FIFO ordering', async () => {
      const order = [];
      const release1 = await lock.acquire();

      const p2 = lock.acquire().then(r => { order.push(2); return r; });
      const p3 = lock.acquire().then(r => { order.push(3); return r; });

      release1();
      const r2 = await p2;
      r2();
      const r3 = await p3;
      r3();

      assert.deepEqual(order, [2, 3]);
    });

    it('tracks queueLength correctly', async () => {
      assert.equal(lock.queueLength, 0);

      const release1 = await lock.acquire();
      assert.equal(lock.queueLength, 0);

      const p2 = lock.acquire();
      assert.equal(lock.queueLength, 1);

      const p3 = lock.acquire();
      assert.equal(lock.queueLength, 2);

      release1();
      const r2 = await p2;
      assert.equal(lock.queueLength, 1);

      r2();
      const r3 = await p3;
      assert.equal(lock.queueLength, 0);
      r3();
    });
  });

  describe('withLock', () => {
    it('runs the function', async () => {
      let called = false;
      await lock.withLock(() => { called = true; });
      assert.equal(called, true);
    });

    it('returns the function result', async () => {
      const result = await lock.withLock(() => 42);
      assert.equal(result, 42);
    });

    it('releases lock on success', async () => {
      await lock.withLock(() => 'ok');
      assert.equal(lock.isLocked, false);
    });

    it('releases lock on throw', async () => {
      await assert.rejects(
        () => lock.withLock(() => { throw new Error('boom'); }),
        { message: 'boom' }
      );
      assert.equal(lock.isLocked, false);
    });

    it('serializes concurrent withLock calls', async () => {
      const order = [];

      const p1 = lock.withLock(async () => {
        order.push('start-1');
        await new Promise(r => setTimeout(r, 20));
        order.push('end-1');
      });

      const p2 = lock.withLock(async () => {
        order.push('start-2');
        await new Promise(r => setTimeout(r, 10));
        order.push('end-2');
      });

      await Promise.all([p1, p2]);
      assert.deepEqual(order, ['start-1', 'end-1', 'start-2', 'end-2']);
    });
  });

  describe('stress', () => {
    it('10 concurrent acquires all serialize correctly', async () => {
      const order = [];
      const release = await lock.acquire();

      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(
          lock.acquire().then(r => {
            order.push(i);
            r();
          })
        );
      }

      release();
      await Promise.all(promises);

      assert.equal(order.length, 10);
      // All indices should be present
      assert.deepEqual([...order].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });
  });
});
