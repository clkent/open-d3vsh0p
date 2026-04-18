const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs/promises');
const os = require('os');
const { resolveProject, loadRegistry, saveRegistry, REGISTRY_PATH, DEVSHOP_ROOT } = require('./registry');

describe('registry', () => {
  describe('path exports', () => {
    it('REGISTRY_PATH ends with project-registry.json', () => {
      assert.equal(path.basename(REGISTRY_PATH), 'project-registry.json');
    });

    it('DEVSHOP_ROOT is an absolute path', () => {
      assert.equal(path.isAbsolute(DEVSHOP_ROOT), true);
    });

    it('REGISTRY_PATH is inside DEVSHOP_ROOT', () => {
      assert.equal(REGISTRY_PATH.startsWith(DEVSHOP_ROOT), true);
    });
  });

  describe('resolveProject', () => {
    const registry = {
      projects: [
        { id: 'proj-001-garden-planner', name: 'Garden Planner' },
        { id: 'proj-002-weather-app', name: 'Weather App' },
        { id: 'proj-003-garden-planner', name: 'Garden Planner v2' }
      ]
    };

    it('returns exact ID match', () => {
      const result = resolveProject(registry, 'proj-001-garden-planner');
      assert.equal(result.id, 'proj-001-garden-planner');
      assert.equal(result.name, 'Garden Planner');
    });

    it('returns unique name-suffix match', () => {
      const result = resolveProject(registry, 'weather-app');
      assert.equal(result.id, 'proj-002-weather-app');
    });

    it('returns null for ambiguous name-suffix match', () => {
      const result = resolveProject(registry, 'garden-planner');
      assert.equal(result, null);
    });

    it('returns null when not found', () => {
      const result = resolveProject(registry, 'nonexistent');
      assert.equal(result, null);
    });

    it('returns null with empty projects array', () => {
      const result = resolveProject({ projects: [] }, 'anything');
      assert.equal(result, null);
    });
  });

  describe('loadRegistry / saveRegistry round-trip', () => {
    let tmpFile;

    beforeEach(async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'registry-test-'));
      tmpFile = path.join(tmpDir, 'project-registry.json');
    });

    afterEach(async () => {
      try {
        await fs.rm(path.dirname(tmpFile), { recursive: true, force: true });
      } catch {}
    });

    it('saveRegistry writes JSON that loadRegistry can read back', async () => {
      // Mock fs to redirect reads/writes to tmpFile instead of real REGISTRY_PATH
      const realReadFile = fs.readFile;
      const realWriteFile = fs.writeFile;
      fs.readFile = async (p, ...args) => {
        if (p === REGISTRY_PATH) return realReadFile(tmpFile, ...args);
        return realReadFile(p, ...args);
      };
      fs.writeFile = async (p, ...args) => {
        if (p === REGISTRY_PATH) return realWriteFile(tmpFile, ...args);
        return realWriteFile(p, ...args);
      };

      try {
        const data = { projects: [{ id: 'proj-001-test', name: 'Test' }] };
        await saveRegistry(data);
        const loaded = await loadRegistry();
        assert.deepEqual(loaded, data);
      } finally {
        fs.readFile = realReadFile;
        fs.writeFile = realWriteFile;
      }
    });

    it('saveRegistry produces pretty-printed JSON with trailing newline', async () => {
      const realWriteFile = fs.writeFile;
      let capturedContent = null;
      fs.writeFile = async (p, content, ...args) => {
        if (p === REGISTRY_PATH) { capturedContent = content; return; }
        return realWriteFile(p, content, ...args);
      };

      try {
        await saveRegistry({ projects: [] });
        assert.equal(capturedContent.endsWith('\n'), true);
        assert.deepEqual(JSON.parse(capturedContent), { projects: [] });
        assert.ok(capturedContent.includes('\n  '), 'should be indented with 2 spaces');
      } finally {
        fs.writeFile = realWriteFile;
      }
    });
  });
});
