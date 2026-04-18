const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const { buildPlist, plistLabel, plistPath } = require('./plist-template');

describe('plist-template', () => {
  describe('plistLabel', () => {
    it('generates correct label format', () => {
      assert.equal(plistLabel('proj-001', 'morning'), 'com.devshop.proj-001.morning');
    });

    it('handles different window names', () => {
      assert.equal(plistLabel('myapp', 'night'), 'com.devshop.myapp.night');
      assert.equal(plistLabel('myapp', 'weekly'), 'com.devshop.myapp.weekly');
    });
  });

  describe('plistPath', () => {
    it('returns path in LaunchAgents directory', () => {
      const result = plistPath('proj-001', 'morning');
      const expected = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.devshop.proj-001.morning.plist');
      assert.equal(result, expected);
    });
  });

  describe('buildPlist', () => {
    it('generates valid XML plist for morning window', () => {
      const xml = buildPlist({
        projectId: 'proj-001',
        windowName: 'morning',
        startHour: 8,
        logDir: '/tmp/logs',
        nodePath: '/usr/local/bin/node'
      });

      assert.ok(xml.includes('<?xml version="1.0"'));
      assert.ok(xml.includes('com.devshop.proj-001.morning'));
      assert.ok(xml.includes('/usr/local/bin/node'));
      assert.ok(xml.includes('--window'));
      assert.ok(xml.includes('<integer>8</integer>'));
      assert.ok(xml.includes('/tmp/logs/morning-stdout.log'));
    });

    it('generates correct args for weekly cadence window', () => {
      const xml = buildPlist({
        projectId: 'proj-001',
        windowName: 'weekly',
        startHour: 2,
        logDir: '/tmp/logs',
        nodePath: '/usr/local/bin/node'
      });

      assert.ok(xml.includes('cadence'));
      assert.ok(xml.includes('run'));
      assert.ok(xml.includes('--type'));
      assert.ok(xml.includes('<key>Weekday</key>'));
    });

    it('generates correct args for monthly cadence window', () => {
      const xml = buildPlist({
        projectId: 'proj-001',
        windowName: 'monthly',
        startHour: 3,
        logDir: '/tmp/logs',
        nodePath: '/usr/local/bin/node'
      });

      assert.ok(xml.includes('cadence'));
      assert.ok(xml.includes('<key>Day</key>'));
      assert.ok(xml.includes('<integer>1</integer>'));
    });

    it('generates daily calendar interval for regular windows', () => {
      const xml = buildPlist({
        projectId: 'proj-001',
        windowName: 'night',
        startHour: 22,
        logDir: '/tmp/logs',
        nodePath: '/usr/local/bin/node'
      });

      assert.ok(xml.includes('<key>Hour</key>'));
      assert.ok(xml.includes('<integer>22</integer>'));
      assert.ok(!xml.includes('<key>Weekday</key>'));
      assert.ok(!xml.includes('<key>Day</key>'));
    });

    it('uses process.execPath when nodePath not provided', () => {
      const xml = buildPlist({
        projectId: 'proj-001',
        windowName: 'morning',
        startHour: 8,
        logDir: '/tmp/logs'
      });

      assert.ok(xml.includes(process.execPath));
    });
  });
});
