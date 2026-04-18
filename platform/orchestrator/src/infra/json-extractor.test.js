const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { extractJson } = require('./json-extractor');

describe('extractJson', () => {
  describe('clean JSON', () => {
    it('parses a plain JSON object', () => {
      const result = extractJson('{"key": "value"}');
      assert.deepEqual(result, { key: 'value' });
    });

    it('parses JSON with surrounding whitespace', () => {
      const result = extractJson('  \n {"a": 1} \n ');
      assert.deepEqual(result, { a: 1 });
    });
  });

  describe('fenced JSON', () => {
    it('extracts JSON from ```json fence', () => {
      const input = '```json\n{"classifications": [{"id": "r1", "classification": "BLOCKING"}]}\n```';
      const result = extractJson(input);
      assert.deepEqual(result, {
        classifications: [{ id: 'r1', classification: 'BLOCKING' }]
      });
    });

    it('extracts JSON from plain ``` fence', () => {
      const input = '```\n{"key": "value"}\n```';
      const result = extractJson(input);
      assert.deepEqual(result, { key: 'value' });
    });

    it('handles fence with surrounding prose', () => {
      const input = 'Here is the result:\n\n```json\n{"a": 1}\n```\n\nDone.';
      const result = extractJson(input);
      assert.deepEqual(result, { a: 1 });
    });
  });

  describe('JSON in prose', () => {
    it('extracts JSON embedded in surrounding text', () => {
      const input = 'Based on my analysis, here is the classification:\n\n{"classifications": [{"id": "setup-db", "classification": "BLOCKING", "reason": "Database must exist"}]}\n\nI hope this helps.';
      const result = extractJson(input);
      assert.ok(result);
      assert.equal(result.classifications.length, 1);
      assert.equal(result.classifications[0].id, 'setup-db');
    });

    it('extracts JSON after several lines of prose', () => {
      const input = 'Let me think about this.\nThe parked items are:\n- setup-db\n- add-api\n\n{"classifications": [{"id": "setup-db", "classification": "BLOCKING", "reason": "needed"}]}';
      const result = extractJson(input);
      assert.ok(result);
      assert.equal(result.classifications[0].classification, 'BLOCKING');
    });
  });

  describe('nested objects', () => {
    it('handles deeply nested JSON', () => {
      const input = '{"a": {"b": {"c": {"d": 1}}}}';
      const result = extractJson(input);
      assert.deepEqual(result, { a: { b: { c: { d: 1 } } } });
    });

    it('handles nested objects in prose', () => {
      const input = 'Result: {"outer": {"inner": [1, 2, 3]}} end';
      const result = extractJson(input);
      assert.deepEqual(result, { outer: { inner: [1, 2, 3] } });
    });
  });

  describe('null and edge cases', () => {
    it('returns null for non-string input', () => {
      assert.equal(extractJson(null), null);
      assert.equal(extractJson(undefined), null);
      assert.equal(extractJson(42), null);
    });

    it('returns null for empty string', () => {
      assert.equal(extractJson(''), null);
    });

    it('returns null for text with no JSON', () => {
      assert.equal(extractJson('This is just plain text with no JSON at all.'), null);
    });

    it('returns null for malformed JSON', () => {
      assert.equal(extractJson('{"key": "value"'), null);
    });

    it('returns null for malformed JSON in fences', () => {
      const input = '```json\n{"key": broken}\n```';
      // Falls through fence, tries brace-depth, fails
      assert.equal(extractJson(input), null);
    });

    it('handles JSON with null values', () => {
      const result = extractJson('{"a": null, "b": [null, 1]}');
      assert.deepEqual(result, { a: null, b: [null, 1] });
    });
  });

  describe('last-valid-JSON strategy', () => {
    it('extracts the last JSON object when multiple are present', () => {
      const input = 'Here is some context: {"wrong": true}\n\nThe actual result is:\n{"classifications": [{"id": "r1", "classification": "BLOCKING"}]}';
      const result = extractJson(input);
      assert.ok(result.classifications, 'should extract the last JSON object');
      assert.equal(result.classifications[0].id, 'r1');
    });

    it('handles braces inside JSON string values', () => {
      const input = 'Explanation text {"message": "use { and } carefully", "status": "ok"}';
      const result = extractJson(input);
      assert.ok(result);
      assert.equal(result.message, 'use { and } carefully');
      assert.equal(result.status, 'ok');
    });

    it('extracts JSON at the end of text after prose with braces', () => {
      const input = 'The function foo() { return 1; } was analyzed.\n\n{"result": "pass"}';
      const result = extractJson(input);
      assert.ok(result);
      assert.equal(result.result, 'pass');
    });
  });
});
