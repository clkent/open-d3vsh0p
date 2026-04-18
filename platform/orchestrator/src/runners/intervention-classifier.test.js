const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { InterventionClassifier } = require('./intervention-classifier');

describe('InterventionClassifier', () => {
  let classifier;

  beforeEach(() => {
    classifier = new InterventionClassifier({ log: async () => {} });
  });

  describe('classify — code bug patterns', () => {
    it('classifies SyntaxError as code_bug', () => {
      const result = classifier.classify('SyntaxError: Unexpected token');
      assert.equal(result.classification, 'code_bug');
    });

    it('classifies TypeError as code_bug', () => {
      const result = classifier.classify('TypeError: Cannot read property of undefined');
      assert.equal(result.classification, 'code_bug');
    });

    it('classifies ReferenceError as code_bug', () => {
      const result = classifier.classify('ReferenceError: foo is not defined');
      assert.equal(result.classification, 'code_bug');
    });

    it('classifies "cannot find module" as code_bug', () => {
      const result = classifier.classify('Error: Cannot find module "./missing-file"');
      assert.equal(result.classification, 'code_bug');
    });

    it('classifies assertion failure as code_bug', () => {
      const result = classifier.classify('AssertionError: assertion failed: expected 1 to equal 2');
      assert.equal(result.classification, 'code_bug');
    });

    it('classifies plain "build failed" as code_bug', () => {
      const result = classifier.classify('Build failed with exit code 1');
      assert.equal(result.classification, 'code_bug');
    });

    it('classifies "build failed" with signing keyword as human_needed', () => {
      classifier.hasIOS = true;
      const result = classifier.classify('Build failed: code signing is required for product type');
      assert.equal(result.classification, 'human_needed');
      assert.equal(result.category, 'signing');
    });

    it('classifies test fix exhaustion as code_bug', () => {
      const result = classifier.classify('Test fix retries exhausted. Last output: ...');
      assert.equal(result.classification, 'code_bug');
    });

    it('classifies import verification failure as code_bug', () => {
      const result = classifier.classify('Import verification failed after all retries.');
      assert.equal(result.classification, 'code_bug');
    });
  });

  describe('classify — universal patterns', () => {
    it('classifies missing API key as human_needed', () => {
      const result = classifier.classify('Error: API_KEY is missing. Set it in your environment.');
      assert.equal(result.classification, 'human_needed');
      assert.equal(result.category, 'credentials');
    });

    it('classifies missing .env as human_needed', () => {
      const result = classifier.classify('.env file is not found in the project root');
      assert.equal(result.classification, 'human_needed');
      assert.equal(result.category, 'credentials');
    });

    it('classifies missing secret as human_needed', () => {
      const result = classifier.classify('Missing secret: DATABASE_URL is required');
      assert.equal(result.classification, 'human_needed');
      assert.equal(result.category, 'credentials');
    });

    it('classifies permission denied as human_needed', () => {
      const result = classifier.classify('Error: EACCES: permission denied');
      assert.equal(result.classification, 'human_needed');
      assert.equal(result.category, 'permissions');
    });

    it('classifies port in use as human_needed', () => {
      const result = classifier.classify('Error: port 3000 is already in use');
      assert.equal(result.classification, 'human_needed');
      assert.equal(result.category, 'permissions');
    });

    it('classifies manual migration as human_needed', () => {
      const result = classifier.classify('Error: manual migration required before proceeding');
      assert.equal(result.classification, 'human_needed');
      assert.equal(result.category, 'database');
    });
  });

  describe('classify — mobile patterns (gated)', () => {
    it('does NOT match signing patterns when hasIOS is false', () => {
      classifier.hasIOS = false;
      const result = classifier.classify('Error: provisioning profile not found');
      assert.equal(result.classification, 'code_bug');
    });

    it('matches signing patterns when hasIOS is true', () => {
      classifier.hasIOS = true;
      const result = classifier.classify('Error: provisioning profile not found');
      assert.equal(result.classification, 'human_needed');
      assert.equal(result.category, 'signing');
    });

    it('matches team ID pattern for iOS', () => {
      classifier.hasIOS = true;
      const result = classifier.classify('Error: No team ID specified for signing');
      assert.equal(result.classification, 'human_needed');
      assert.equal(result.category, 'signing');
    });

    it('matches pod install pattern for iOS', () => {
      classifier.hasIOS = true;
      const result = classifier.classify('Error: pods not found. Run pod install.');
      assert.equal(result.classification, 'human_needed');
      assert.equal(result.category, 'dependency');
    });

    it('matches xcode select pattern for iOS', () => {
      classifier.hasIOS = true;
      const result = classifier.classify('Error: xcode not found. Run xcode-select --install');
      assert.equal(result.classification, 'human_needed');
      assert.equal(result.category, 'toolchain');
    });

    it('matches simulator not available for iOS', () => {
      classifier.hasIOS = true;
      const result = classifier.classify('Error: no simulator available for iOS 17');
      assert.equal(result.classification, 'human_needed');
      assert.equal(result.category, 'simulator');
    });

    it('does NOT match Android patterns when hasAndroid is false', () => {
      classifier.hasAndroid = false;
      const result = classifier.classify('ANDROID_HOME is not set');
      assert.equal(result.classification, 'code_bug');
    });

    it('matches ANDROID_HOME pattern when hasAndroid is true', () => {
      classifier.hasAndroid = true;
      const result = classifier.classify('ANDROID_HOME is not set');
      assert.equal(result.classification, 'human_needed');
      assert.equal(result.category, 'toolchain');
    });

    it('matches Android keystore pattern', () => {
      classifier.hasAndroid = true;
      const result = classifier.classify('Error: keystore not found at release.keystore');
      assert.equal(result.classification, 'human_needed');
      assert.equal(result.category, 'signing');
    });

    it('matches gradle not found for Android', () => {
      classifier.hasAndroid = true;
      const result = classifier.classify('Error: gradle not found. Install Gradle or use the wrapper.');
      assert.equal(result.classification, 'human_needed');
      assert.equal(result.category, 'dependency');
    });
  });

  describe('classify — edge cases', () => {
    it('returns code_bug for null error', () => {
      const result = classifier.classify(null);
      assert.equal(result.classification, 'code_bug');
    });

    it('returns code_bug for empty string', () => {
      const result = classifier.classify('');
      assert.equal(result.classification, 'code_bug');
    });

    it('returns code_bug for unrecognized error', () => {
      const result = classifier.classify('Something went wrong in the flux capacitor');
      assert.equal(result.classification, 'code_bug');
    });
  });

  describe('generateInstructions', () => {
    it('generates signing instructions', () => {
      const instructions = classifier.generateInstructions(
        'Code signing error: no team ID',
        'signing'
      );
      assert.equal(instructions.title, 'Configure code signing');
      assert.ok(instructions.steps.length > 0);
      assert.ok(instructions.verifyCommand);
    });

    it('generates credentials instructions', () => {
      const instructions = classifier.generateInstructions(
        'Missing API key: STRIPE_KEY is required',
        'credentials'
      );
      assert.equal(instructions.title, 'Configure required credentials');
      assert.ok(instructions.steps.length > 0);
    });

    it('extracts key name from credentials error', () => {
      const instructions = classifier.generateInstructions(
        'Error: `STRIPE_SECRET_KEY` is not set',
        'credentials'
      );
      assert.ok(instructions.steps.some(s => s.includes('STRIPE_SECRET_KEY')));
    });

    it('generates generic instructions for unknown category', () => {
      const instructions = classifier.generateInstructions(
        'Some unknown error',
        'unknown_category'
      );
      assert.equal(instructions.title, 'Manual intervention required');
      assert.ok(instructions.steps.length > 0);
    });

    it('generates simulator instructions', () => {
      const instructions = classifier.generateInstructions(
        'No simulator available',
        'simulator'
      );
      assert.equal(instructions.title, 'Configure simulator or device');
      assert.ok(instructions.verifyCommand);
    });
  });
});
