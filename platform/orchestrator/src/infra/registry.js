const path = require('path');
const fs = require('fs/promises');

const DEVSHOP_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const REGISTRY_PATH = path.join(DEVSHOP_ROOT, 'project-registry.json');

/**
 * Resolve a project by full ID or just the name portion.
 * e.g. "garden-planner" matches "proj-001-garden-planner"
 */
function resolveProject(registry, input) {
  // Exact ID match
  const exact = registry.projects.find(p => p.id === input);
  if (exact) return exact;

  // Match by name suffix (the part after proj-NNN-)
  const byName = registry.projects.filter(p => {
    const namePart = p.id.replace(/^proj-\d+-/, '');
    return namePart === input;
  });

  if (byName.length === 1) return byName[0];

  if (byName.length > 1) {
    console.error(`Ambiguous project name "${input}". Did you mean:`);
    for (const p of byName) {
      console.error(`  - ${p.id} (${p.name})`);
    }
    return null;
  }

  console.error(`Project "${input}" not found in project-registry.json`);
  const available = registry.projects.map(p => {
    const namePart = p.id.replace(/^proj-\d+-/, '');
    return `  - ${namePart} (${p.id})`;
  }).join('\n');
  console.error(available ? `Available projects:\n${available}` : 'No projects registered.');
  return null;
}

async function loadRegistry() {
  try {
    const raw = await fs.readFile(REGISTRY_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { projects: [] };
  }
}

async function saveRegistry(registry) {
  await fs.writeFile(REGISTRY_PATH, JSON.stringify(registry, null, 2) + '\n');
}

module.exports = { resolveProject, loadRegistry, saveRegistry, REGISTRY_PATH, DEVSHOP_ROOT };
