/**
 * Extract a JSON object from text that may contain prose, markdown fences, or clean JSON.
 *
 * Strategies (in order):
 *  1. Markdown code fences (```json ... ``` or ``` ... ```)
 *  2. JSON embedded in surrounding text (first `{` to matching `}` via brace-depth)
 *  3. Clean JSON (entire text is a JSON object)
 *
 * Returns the parsed object, or null if no valid JSON is found.
 */
function extractJson(text) {
  if (typeof text !== 'string') return null;

  // Try 1: markdown code fences
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      // Not valid JSON in fence — fall through
    }
  }

  // Try 2: Find the last valid JSON object in the text (search backward)
  const lastBrace = text.lastIndexOf('}');
  if (lastBrace !== -1) {
    for (let i = lastBrace; i >= 0; i--) {
      if (text[i] === '{') {
        try {
          return JSON.parse(text.slice(i, lastBrace + 1));
        } catch {
          // Not valid from this position — keep scanning backward
        }
      }
    }
  }

  // Try 3: Clean JSON (entire text is JSON)
  try {
    return JSON.parse(text.trim());
  } catch {
    return null;
  }
}

module.exports = { extractJson };
