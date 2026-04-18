/**
 * Agent pool: assigns implementation agent personas to parallel groups.
 * Random assignment from the available persona list.
 */

const PERSONAS = [
  { name: 'Jordan', agentType: 'implementation-agent' },
  { name: 'Alex',   agentType: 'implementation-agent' },
  { name: 'Sam',    agentType: 'implementation-agent' },
  { name: 'Taylor', agentType: 'implementation-agent' }
];

class AgentPool {
  constructor(personas = PERSONAS) {
    this.personas = personas;
  }

  /**
   * Assign a persona to a group at random.
   * @returns {{ name: string, agentType: string }}
   */
  assign() {
    const index = Math.floor(Math.random() * this.personas.length);
    return { ...this.personas[index] };
  }

  /**
   * Assign personas to multiple groups at once.
   * Each group gets a randomly selected persona (no duplicates when possible).
   * @param {number} count - Number of assignments needed
   * @returns {Array<{ name: string, agentType: string }>}
   */
  assignMany(count) {
    if (count >= this.personas.length) {
      // Shuffle all personas, then fill remaining slots randomly
      const shuffled = this._shuffle([...this.personas]);
      const assignments = shuffled.map(p => ({ ...p }));
      for (let i = this.personas.length; i < count; i++) {
        assignments.push(this.assign());
      }
      return assignments;
    }

    // Fewer groups than personas — pick random unique subset
    const shuffled = this._shuffle([...this.personas]);
    return shuffled.slice(0, count).map(p => ({ ...p }));
  }

  /**
   * Get all available persona names.
   */
  get names() {
    return this.personas.map(p => p.name);
  }

  /**
   * Fisher-Yates shuffle.
   */
  _shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

// PERSONAS exported for testing
module.exports = { AgentPool, PERSONAS };
