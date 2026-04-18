const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { EnvManager } = require('./env-manager');

describe('EnvManager', () => {
  let tmpDir;
  let manager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'env-manager-test-'));
    manager = new EnvManager(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('hasEnvExample', () => {
    it('returns true when .env.example exists', async () => {
      await fs.writeFile(path.join(tmpDir, '.env.example'), 'KEY=value');
      assert.equal(await manager.hasEnvExample(), true);
    });

    it('returns false when .env.example is missing', async () => {
      assert.equal(await manager.hasEnvExample(), false);
    });
  });

  describe('parseEnvExample', () => {
    it('parses keys and placeholders', async () => {
      await fs.writeFile(path.join(tmpDir, '.env.example'),
        'API_KEY=your_api_key_here\nSECRET=changeme\n');
      const entries = await manager.parseEnvExample();
      assert.equal(entries.length, 2);
      assert.equal(entries[0].key, 'API_KEY');
      assert.equal(entries[0].placeholder, 'your_api_key_here');
      assert.equal(entries[1].key, 'SECRET');
      assert.equal(entries[1].placeholder, 'changeme');
    });

    it('extracts comment and signup URL', async () => {
      await fs.writeFile(path.join(tmpDir, '.env.example'), [
        '# Trefle API - Botanical plant data',
        '# Get your API key from: https://trefle.io/',
        'TREFLE_API_KEY=your_trefle_api_key_here',
        ''
      ].join('\n'));
      const entries = await manager.parseEnvExample();
      assert.equal(entries.length, 1);
      assert.equal(entries[0].comment, 'Trefle API - Botanical plant data Get your API key from: https://trefle.io/');
      assert.equal(entries[0].signupUrl, 'https://trefle.io/');
    });

    it('skips keys with "No API key required" in comments', async () => {
      await fs.writeFile(path.join(tmpDir, '.env.example'), [
        '# USDA Plant Hardiness Zone API',
        '# No API key required - this is a free public service',
        'USDA_ENDPOINT=https://phzmapi.org/',
        '',
        '# Real key needed',
        'REAL_KEY=your_key_here',
        ''
      ].join('\n'));
      const entries = await manager.parseEnvExample();
      assert.equal(entries.length, 1);
      assert.equal(entries[0].key, 'REAL_KEY');
    });

    it('resets comment block on blank lines', async () => {
      await fs.writeFile(path.join(tmpDir, '.env.example'), [
        '# Comment about section',
        '',
        'STANDALONE_KEY=value',
        ''
      ].join('\n'));
      const entries = await manager.parseEnvExample();
      assert.equal(entries.length, 1);
      assert.equal(entries[0].comment, '');
      assert.equal(entries[0].signupUrl, null);
    });
  });

  describe('getExistingKeys', () => {
    it('returns set of keys with real values', async () => {
      await fs.writeFile(path.join(tmpDir, '.env'), 'API_KEY=abc123\nDB_URL=postgres://localhost\n');
      const keys = await manager.getExistingKeys();
      assert.equal(keys.has('API_KEY'), true);
      assert.equal(keys.has('DB_URL'), true);
    });

    it('excludes keys with placeholder values', async () => {
      await fs.writeFile(path.join(tmpDir, '.env'), 'API_KEY=your_api_key_here\nSECRET=changeme\n');
      const keys = await manager.getExistingKeys();
      assert.equal(keys.has('API_KEY'), false);
      assert.equal(keys.has('SECRET'), false);
    });

    it('excludes keys with empty values', async () => {
      await fs.writeFile(path.join(tmpDir, '.env'), 'API_KEY=\n');
      const keys = await manager.getExistingKeys();
      assert.equal(keys.has('API_KEY'), false);
    });

    it('returns empty set when .env does not exist', async () => {
      const keys = await manager.getExistingKeys();
      assert.equal(keys.size, 0);
    });
  });

  describe('getMissingKeys', () => {
    it('returns keys in example but missing from .env', async () => {
      await fs.writeFile(path.join(tmpDir, '.env.example'), 'KEY_A=placeholder\nKEY_B=placeholder\n');
      await fs.writeFile(path.join(tmpDir, '.env'), 'KEY_A=real_value\n');
      const missing = await manager.getMissingKeys();
      assert.equal(missing.length, 1);
      assert.equal(missing[0].key, 'KEY_B');
    });

    it('returns all keys when .env does not exist', async () => {
      await fs.writeFile(path.join(tmpDir, '.env.example'), 'KEY_A=placeholder\nKEY_B=placeholder\n');
      const missing = await manager.getMissingKeys();
      assert.equal(missing.length, 2);
    });

    it('includes keys that have placeholder values in .env', async () => {
      await fs.writeFile(path.join(tmpDir, '.env.example'), 'KEY_A=your_key_here\n');
      await fs.writeFile(path.join(tmpDir, '.env'), 'KEY_A=your_key_here\n');
      const missing = await manager.getMissingKeys();
      assert.equal(missing.length, 1);
    });
  });

  describe('writeKeys', () => {
    it('creates .env with 0o600 permissions when it does not exist', async () => {
      await fs.writeFile(path.join(tmpDir, '.env.example'), 'KEY_A=placeholder\nKEY_B=placeholder\n');
      await manager.writeKeys({ KEY_A: 'value_a' });
      const stat = await fs.stat(path.join(tmpDir, '.env'));
      assert.equal(stat.mode & 0o777, 0o600);
    });

    it('creates .env from .env.example template with values filled in', async () => {
      await fs.writeFile(path.join(tmpDir, '.env.example'), [
        '# Comment',
        'KEY_A=placeholder',
        'KEY_B=placeholder',
        ''
      ].join('\n'));
      await manager.writeKeys({ KEY_A: 'real_a' });
      const content = await fs.readFile(path.join(tmpDir, '.env'), 'utf-8');
      assert.ok(content.includes('KEY_A=real_a'));
      assert.ok(content.includes('KEY_B=placeholder'));
      assert.ok(content.includes('# Comment'));
    });

    it('merges into existing .env without clobbering unrelated keys', async () => {
      await fs.writeFile(path.join(tmpDir, '.env'), 'EXISTING=keep_me\nUPDATE_ME=old_value\n');
      await manager.writeKeys({ UPDATE_ME: 'new_value', NEW_KEY: 'added' });
      const content = await fs.readFile(path.join(tmpDir, '.env'), 'utf-8');
      assert.ok(content.includes('EXISTING=keep_me'));
      assert.ok(content.includes('UPDATE_ME=new_value'));
      assert.ok(content.includes('NEW_KEY=added'));
      assert.ok(!content.includes('old_value'));
    });

    it('does nothing when keyValues is empty', async () => {
      await manager.writeKeys({});
      // .env should not be created
      await assert.rejects(fs.access(path.join(tmpDir, '.env')));
    });
  });
});
