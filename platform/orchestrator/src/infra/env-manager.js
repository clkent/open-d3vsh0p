const fs = require('fs/promises');
const path = require('path');

const PLACEHOLDER_PATTERN = /^(your_\w+_here|changeme|TODO|FIXME)?$/i;

class EnvManager {
  constructor(projectDir) {
    this.projectDir = projectDir;
    this.envExamplePath = path.join(projectDir, '.env.example');
    this.envPath = path.join(projectDir, '.env');
  }

  /**
   * Check if .env.example exists in the project.
   */
  async hasEnvExample() {
    try {
      await fs.access(this.envExamplePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Parse .env.example into structured key info.
   * Returns: [{ key, placeholder, comment, signupUrl }]
   *
   * Groups comment lines preceding a KEY=value line.
   * Extracts URLs from comments. Skips keys with "No API key required" in comments.
   */
  async parseEnvExample() {
    const content = await fs.readFile(this.envExamplePath, 'utf-8');
    return this._parseEnvExampleContent(content);
  }

  _parseEnvExampleContent(content) {
    const lines = content.split('\n');
    const entries = [];
    let commentBlock = [];

    for (const line of lines) {
      const trimmed = line.trim();

      // Collect comment lines
      if (trimmed.startsWith('#')) {
        commentBlock.push(trimmed.slice(1).trim());
        continue;
      }

      // Parse KEY=value lines
      const kvMatch = trimmed.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (kvMatch) {
        const comment = commentBlock.join(' ');

        // Skip keys where comments say no key is required
        if (/no api key required/i.test(comment)) {
          commentBlock = [];
          continue;
        }

        // Extract URL from comments
        const urlMatch = comment.match(/(https?:\/\/[^\s]+)/);

        entries.push({
          key: kvMatch[1],
          placeholder: kvMatch[2],
          comment,
          signupUrl: urlMatch ? urlMatch[1] : null
        });
        commentBlock = [];
        continue;
      }

      // Blank line resets comment block
      if (!trimmed) {
        commentBlock = [];
      }
    }

    return entries;
  }

  /**
   * Parse existing .env file and return set of keys with real (non-placeholder) values.
   */
  async getExistingKeys() {
    let content;
    try {
      content = await fs.readFile(this.envPath, 'utf-8');
    } catch {
      return new Set();
    }
    return this._getExistingKeysFromContent(content);
  }

  _getExistingKeysFromContent(content) {
    const keys = new Set();
    for (const line of content.split('\n')) {
      const match = line.trim().match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (match) {
        const value = match[2].trim();
        if (value && !PLACEHOLDER_PATTERN.test(value)) {
          keys.add(match[1]);
        }
      }
    }
    return keys;
  }

  /**
   * Get keys defined in .env.example but missing or placeholder in .env.
   * Returns: [{ key, placeholder, comment, signupUrl }]
   */
  async getMissingKeys() {
    const example = await this.parseEnvExample();
    const existing = await this.getExistingKeys();
    return example.filter(entry => !existing.has(entry.key));
  }

  /**
   * Write key-value pairs to .env file.
   * If .env exists, updates matching keys and preserves other content.
   * If .env doesn't exist, creates from .env.example template with values filled in.
   * Sets file permissions to 0o600.
   *
   * @param {Object} keyValues - { KEY: 'value', ... }
   */
  async writeKeys(keyValues) {
    const keys = Object.keys(keyValues);
    if (keys.length === 0) return;

    let content;
    let exists = true;
    try {
      content = await fs.readFile(this.envPath, 'utf-8');
    } catch {
      exists = false;
    }

    if (exists) {
      // Update existing .env: replace matching key lines, preserve everything else
      const lines = content.split('\n');
      const updated = new Set();
      const result = lines.map(line => {
        const match = line.match(/^([A-Z_][A-Z0-9_]*)=/);
        if (match && keyValues[match[1]] !== undefined) {
          updated.add(match[1]);
          return `${match[1]}=${keyValues[match[1]]}`;
        }
        return line;
      });

      // Append any keys not already present
      for (const key of keys) {
        if (!updated.has(key)) {
          result.push(`${key}=${keyValues[key]}`);
        }
      }

      content = result.join('\n');
    } else {
      // Create from .env.example template
      try {
        const template = await fs.readFile(this.envExamplePath, 'utf-8');
        const lines = template.split('\n');
        content = lines.map(line => {
          const match = line.match(/^([A-Z_][A-Z0-9_]*)=/);
          if (match && keyValues[match[1]] !== undefined) {
            return `${match[1]}=${keyValues[match[1]]}`;
          }
          return line;
        }).join('\n');
      } catch {
        // No .env.example either — create minimal .env
        content = keys.map(k => `${k}=${keyValues[k]}`).join('\n') + '\n';
      }
    }

    await fs.writeFile(this.envPath, content, { mode: 0o600 });
  }
}

// PLACEHOLDER_PATTERN exported for testing
module.exports = { EnvManager, PLACEHOLDER_PATTERN };
