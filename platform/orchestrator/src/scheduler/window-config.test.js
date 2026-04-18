const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validateScheduleConfig, getWindowConfig, getEnabledWindows, VALID_WINDOWS } = require('./window-config');

describe('window-config', () => {
  describe('VALID_WINDOWS', () => {
    it('contains expected window names', () => {
      assert.deepEqual(VALID_WINDOWS, ['night', 'morning', 'day', 'techdebt']);
    });
  });

  describe('validateScheduleConfig', () => {
    it('returns valid for correct config', () => {
      const result = validateScheduleConfig({
        windows: {
          morning: { enabled: true, startHour: 8, endHour: 12 },
          night: { enabled: false }
        }
      });
      assert.deepEqual(result, { valid: true });
    });

    it('returns error for missing windows', () => {
      const result = validateScheduleConfig({});
      assert.equal(result.valid, false);
      assert.ok(result.errors[0].includes('Missing schedule.windows'));
    });

    it('returns error for null schedule', () => {
      const result = validateScheduleConfig(null);
      assert.equal(result.valid, false);
    });

    it('returns error for unknown window name', () => {
      const result = validateScheduleConfig({
        windows: { invalid: { enabled: true, startHour: 8, endHour: 12 } }
      });
      assert.equal(result.valid, false);
      assert.ok(result.errors[0].includes('Unknown window'));
    });

    it('returns error for out-of-range startHour', () => {
      const result = validateScheduleConfig({
        windows: { morning: { enabled: true, startHour: 25, endHour: 12 } }
      });
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('startHour')));
    });

    it('returns error for startHour >= endHour', () => {
      const result = validateScheduleConfig({
        windows: { morning: { enabled: true, startHour: 12, endHour: 8 } }
      });
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('must be less than')));
    });

    it('returns error for negative budgetUsd', () => {
      const result = validateScheduleConfig({
        windows: { morning: { enabled: true, startHour: 8, endHour: 12, budgetUsd: -5 } }
      });
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('budgetUsd')));
    });

    it('returns error for zero timeLimitHours', () => {
      const result = validateScheduleConfig({
        windows: { morning: { enabled: true, startHour: 8, endHour: 12, timeLimitHours: 0 } }
      });
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('timeLimitHours')));
    });

    it('detects overlapping windows', () => {
      const result = validateScheduleConfig({
        windows: {
          morning: { enabled: true, startHour: 8, endHour: 14 },
          day: { enabled: true, startHour: 12, endHour: 18 }
        }
      });
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('Overlapping')));
    });

    it('passes non-overlapping windows', () => {
      const result = validateScheduleConfig({
        windows: {
          morning: { enabled: true, startHour: 8, endHour: 12 },
          day: { enabled: true, startHour: 12, endHour: 18 }
        }
      });
      assert.deepEqual(result, { valid: true });
    });

    it('skips disabled windows in overlap check', () => {
      const result = validateScheduleConfig({
        windows: {
          morning: { enabled: true, startHour: 8, endHour: 14 },
          day: { enabled: false, startHour: 12, endHour: 18 }
        }
      });
      assert.deepEqual(result, { valid: true });
    });

    it('returns error for missing startHour/endHour', () => {
      const result = validateScheduleConfig({
        windows: { morning: { enabled: true } }
      });
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('missing startHour')));
    });
  });

  describe('getWindowConfig', () => {
    it('returns window config for valid window name', () => {
      const schedule = {
        windows: { morning: { enabled: true, startHour: 8, endHour: 12 } }
      };
      const result = getWindowConfig(schedule, 'morning');
      assert.deepEqual(result, { enabled: true, startHour: 8, endHour: 12 });
    });

    it('returns null for invalid window name', () => {
      const schedule = { windows: {} };
      assert.equal(getWindowConfig(schedule, 'invalid'), null);
    });

    it('returns null for valid name not in schedule', () => {
      const schedule = { windows: {} };
      assert.equal(getWindowConfig(schedule, 'night'), null);
    });
  });

  describe('getEnabledWindows', () => {
    it('returns only enabled windows', () => {
      const schedule = {
        windows: {
          morning: { enabled: true, startHour: 8, endHour: 12 },
          night: { enabled: false, startHour: 22, endHour: 6 },
          day: { enabled: true, startHour: 12, endHour: 18 }
        }
      };
      const result = getEnabledWindows(schedule);
      assert.equal(result.length, 2);
      assert.ok(result.some(w => w.name === 'morning'));
      assert.ok(result.some(w => w.name === 'day'));
    });

    it('returns empty array when no windows enabled', () => {
      const schedule = {
        windows: { morning: { enabled: false } }
      };
      assert.deepEqual(getEnabledWindows(schedule), []);
    });

    it('includes name property on each window', () => {
      const schedule = {
        windows: { morning: { enabled: true, startHour: 8, endHour: 12 } }
      };
      const result = getEnabledWindows(schedule);
      assert.equal(result[0].name, 'morning');
      assert.equal(result[0].startHour, 8);
    });
  });
});
