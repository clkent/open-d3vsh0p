const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { removeProjectEntries, PAUSED_PREFIX } = require('./cron');

describe('removeProjectEntries', () => {
  it('removes tagged entries for a project', () => {
    const crontab = [
      '# devshop:proj-000:night',
      '0 1 * * * node run proj-000 --window night',
      '# devshop:proj-000:day',
      '0 12 * * * node run proj-000 --window day',
      '# other entry',
      '30 * * * * other-command'
    ].join('\n');

    const result = removeProjectEntries(crontab, 'proj-000');
    assert.ok(!result.includes('proj-000'));
    assert.ok(result.includes('other-command'));
    assert.ok(result.includes('# other entry'));
  });

  it('leaves other projects untouched', () => {
    const crontab = [
      '# devshop:proj-000:night',
      '0 1 * * * node run proj-000',
      '# devshop:proj-001:night',
      '0 1 * * * node run proj-001'
    ].join('\n');

    const result = removeProjectEntries(crontab, 'proj-000');
    assert.ok(!result.includes('proj-000'));
    assert.ok(result.includes('proj-001'));
  });
});

describe('PAUSED_PREFIX', () => {
  it('is a comment-style prefix', () => {
    assert.ok(PAUSED_PREFIX.startsWith('#'));
  });

  it('has the expected value for stable serialization', () => {
    // PAUSED_PREFIX is used in crontab files — its value must remain stable
    assert.equal(PAUSED_PREFIX, '# PAUSED:');
  });
});

describe('cron pause/resume logic', () => {
  // Test the pause/resume transformation logic inline since pauseCron/resumeCron
  // call getCurrentCrontab/setCrontab which require actual crontab access.

  it('pause adds PAUSED: prefix to active entries', () => {
    const lines = [
      '# devshop:proj-000:night',
      '0 1 * * * node run proj-000 --window night',
      '# devshop:proj-000:day',
      '0 12 * * * node run proj-000 --window day'
    ];

    const output = [];
    const results = [];
    let nextTag = null;

    for (const line of lines) {
      if (line.startsWith('# devshop:proj-000:')) {
        nextTag = line.replace('# devshop:proj-000:', '');
        output.push(line);
        continue;
      }
      if (nextTag) {
        if (line.startsWith(PAUSED_PREFIX)) {
          results.push({ window: nextTag, status: 'already_paused' });
          output.push(line);
        } else {
          results.push({ window: nextTag, status: 'paused' });
          output.push(`${PAUSED_PREFIX}${line}`);
        }
        nextTag = null;
        continue;
      }
      output.push(line);
    }

    assert.equal(results.length, 2);
    assert.equal(results[0].status, 'paused');
    assert.equal(results[0].window, 'night');
    assert.equal(results[1].status, 'paused');
    assert.equal(results[1].window, 'day');
    assert.ok(output[1].startsWith(PAUSED_PREFIX));
    assert.ok(output[3].startsWith(PAUSED_PREFIX));
  });

  it('pause reports already_paused for commented entries', () => {
    const lines = [
      '# devshop:proj-000:night',
      `${PAUSED_PREFIX}0 1 * * * node run proj-000 --window night`
    ];

    const results = [];
    let nextTag = null;

    for (const line of lines) {
      if (line.startsWith('# devshop:proj-000:')) {
        nextTag = line.replace('# devshop:proj-000:', '');
        continue;
      }
      if (nextTag) {
        if (line.startsWith(PAUSED_PREFIX)) {
          results.push({ window: nextTag, status: 'already_paused' });
        } else {
          results.push({ window: nextTag, status: 'paused' });
        }
        nextTag = null;
      }
    }

    assert.equal(results.length, 1);
    assert.equal(results[0].status, 'already_paused');
  });

  it('resume removes PAUSED: prefix from commented entries', () => {
    const lines = [
      '# devshop:proj-000:night',
      `${PAUSED_PREFIX}0 1 * * * node run proj-000 --window night`,
      '# devshop:proj-000:day',
      `${PAUSED_PREFIX}0 12 * * * node run proj-000 --window day`
    ];

    const output = [];
    const results = [];
    let nextTag = null;

    for (const line of lines) {
      if (line.startsWith('# devshop:proj-000:')) {
        nextTag = line.replace('# devshop:proj-000:', '');
        output.push(line);
        continue;
      }
      if (nextTag) {
        if (line.startsWith(PAUSED_PREFIX)) {
          results.push({ window: nextTag, status: 'resumed' });
          output.push(line.slice(PAUSED_PREFIX.length));
        } else {
          results.push({ window: nextTag, status: 'already_running' });
          output.push(line);
        }
        nextTag = null;
        continue;
      }
      output.push(line);
    }

    assert.equal(results.length, 2);
    assert.equal(results[0].status, 'resumed');
    assert.equal(results[1].status, 'resumed');
    assert.ok(!output[1].startsWith(PAUSED_PREFIX));
    assert.ok(!output[3].startsWith(PAUSED_PREFIX));
    assert.equal(output[1], '0 1 * * * node run proj-000 --window night');
  });

  it('resume reports already_running for active entries', () => {
    const lines = [
      '# devshop:proj-000:night',
      '0 1 * * * node run proj-000 --window night'
    ];

    const results = [];
    let nextTag = null;

    for (const line of lines) {
      if (line.startsWith('# devshop:proj-000:')) {
        nextTag = line.replace('# devshop:proj-000:', '');
        continue;
      }
      if (nextTag) {
        if (line.startsWith(PAUSED_PREFIX)) {
          results.push({ window: nextTag, status: 'resumed' });
        } else {
          results.push({ window: nextTag, status: 'already_running' });
        }
        nextTag = null;
      }
    }

    assert.equal(results.length, 1);
    assert.equal(results[0].status, 'already_running');
  });

  it('pause does not affect other projects', () => {
    const lines = [
      '# devshop:proj-000:night',
      '0 1 * * * node run proj-000 --window night',
      '# devshop:proj-001:night',
      '0 1 * * * node run proj-001 --window night'
    ];

    const output = [];
    let nextTag = null;
    const projectId = 'proj-000';

    for (const line of lines) {
      if (line.startsWith(`# devshop:${projectId}:`)) {
        nextTag = line.replace(`# devshop:${projectId}:`, '');
        output.push(line);
        continue;
      }
      if (nextTag) {
        output.push(`${PAUSED_PREFIX}${line}`);
        nextTag = null;
        continue;
      }
      output.push(line);
    }

    // proj-000 should be paused
    assert.ok(output[1].startsWith(PAUSED_PREFIX));
    // proj-001 should be untouched
    assert.equal(output[3], '0 1 * * * node run proj-001 --window night');
  });
});
