const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { resolveProject } = require('./index');

const registry = {
  projects: [
    { id: 'proj-000-test-app', name: 'Test App' },
    { id: 'proj-001-garden-planner', name: 'Garden Planner' },
    { id: 'proj-002-test-app', name: 'Test App v2' }
  ]
};

describe('resolveProject', () => {
  it('resolves by exact ID', () => {
    const result = resolveProject(registry, 'proj-001-garden-planner');
    assert.equal(result.id, 'proj-001-garden-planner');
  });

  it('resolves by name portion', () => {
    const result = resolveProject(registry, 'garden-planner');
    assert.equal(result.id, 'proj-001-garden-planner');
  });

  it('returns null for ambiguous name', () => {
    const result = resolveProject(registry, 'test-app');
    assert.equal(result, null);
  });

  it('returns null for unknown name', () => {
    const result = resolveProject(registry, 'nonexistent');
    assert.equal(result, null);
  });

  it('prefers exact ID over name match', () => {
    const result = resolveProject(registry, 'proj-000-test-app');
    assert.equal(result.id, 'proj-000-test-app');
  });
});
