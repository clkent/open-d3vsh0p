const fs = require('fs/promises');
const path = require('path');

class OpenSpecReader {
  constructor(projectDir) {
    this.projectDir = projectDir;
    this.openspecDir = path.join(projectDir, 'openspec');
    this._projectMdCache = null;
  }

  async _getProjectMd() {
    if (!this._projectMdCache) {
      const projectMdPath = path.join(this.openspecDir, 'project.md');
      this._projectMdCache = await fs.readFile(projectMdPath, 'utf-8');
    }
    return this._projectMdCache;
  }

  async parseTechStack() {
    const content = await this._getProjectMd();
    const lines = content.split('\n');
    let inTechStack = false;
    const bullets = [];

    for (const line of lines) {
      if (line.startsWith('## Tech Stack')) {
        inTechStack = true;
        continue;
      }
      if (inTechStack && line.startsWith('## ')) {
        break;
      }
      if (inTechStack && line.startsWith('- ')) {
        bullets.push(line.slice(2).trim());
      }
    }

    return bullets.length > 0 ? bullets.join(', ') : 'Not specified';
  }

}

module.exports = { OpenSpecReader };
