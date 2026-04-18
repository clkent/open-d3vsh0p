const fs = require('fs/promises');
const path = require('path');

class TemplateEngine {
  constructor(templatesDir) {
    this.templatesDir = templatesDir;
    this._partialCache = new Map();
  }

  async renderAgentPrompt(agentType, vars) {
    const templatePath = path.join(this.templatesDir, agentType, 'system-prompt.md');
    let template = await fs.readFile(templatePath, 'utf-8');

    // Resolve partial includes: {{>partial_name}}
    template = await this._resolvePartials(template);

    // Replace variables: {{KEY}} (escape template chars in values first)
    for (const [key, value] of Object.entries(vars)) {
      template = template.replaceAll(`{{${key}}}`, TemplateEngine._escapeTemplateChars(value));
    }

    return template;
  }

  async getAgentConfig(agentType) {
    const configPath = path.join(this.templatesDir, agentType, 'config.json');
    try {
      const raw = await fs.readFile(configPath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  renderString(template, vars) {
    let result = template;
    for (const [key, value] of Object.entries(vars)) {
      result = result.replaceAll(`{{${key}}}`, TemplateEngine._escapeTemplateChars(value));
    }
    return result;
  }

  static _escapeTemplateChars(value) {
    if (typeof value !== 'string') return value;
    return value.replaceAll('{{', '\\{\\{').replaceAll('}}', '\\}\\}');
  }

  async _resolvePartials(template) {
    const partialPattern = /\{\{>([a-zA-Z0-9_-]+)\}\}/g;
    let result = template;
    let match;

    // Collect all partial references
    const partials = [];
    while ((match = partialPattern.exec(template)) !== null) {
      partials.push({ placeholder: match[0], name: match[1] });
    }

    // Load and replace each partial
    for (const { placeholder, name } of partials) {
      const content = await this._loadPartial(name);
      result = result.replace(placeholder, content);
    }

    return result;
  }

  async _loadPartial(name) {
    if (this._partialCache.has(name)) {
      return this._partialCache.get(name);
    }

    const partialPath = path.join(this.templatesDir, '_shared', `${name}.md`);
    try {
      const content = await fs.readFile(partialPath, 'utf-8');
      this._partialCache.set(name, content.trimEnd());
      return content.trimEnd();
    } catch {
      // Return the placeholder unchanged if partial not found
      return `{{>${name}}}`;
    }
  }
}

module.exports = { TemplateEngine };
