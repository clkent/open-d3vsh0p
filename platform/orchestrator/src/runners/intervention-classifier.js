const { detectIOSProject, detectAndroidProject } = require('../quality/health-checker');

/**
 * Patterns that indicate code bugs — skip intervention classification.
 * These are never human-actionable and should remain as normal parks.
 */
const CODE_BUG_PATTERNS = [
  /SyntaxError/i,
  /TypeError/i,
  /ReferenceError/i,
  /cannot find module/i,
  /assertion.*failed/i,
  /build failed(?!.*(?:signing|team.?id|provisioning|certificate|keychain))/i,
  /test fix retries exhausted/i,
  /review retries exhausted/i,
  /no code changes produced/i,
  /convention.*violation/i,
  /completeness.*violation/i,
  /import verification failed/i
];

/**
 * Universal patterns — apply to all project types.
 */
const UNIVERSAL_PATTERNS = [
  {
    category: 'credentials',
    pattern: /api.?key.*(missing|required|invalid|not.?found|undefined)|missing.*(secret|token|credential|api.?key)|\.env.*(missing|not.?found)|environment.?variable.*(missing|required|not.?set)/i
  },
  {
    category: 'permissions',
    pattern: /permission.?denied|access.?denied|EACCES|port.*(in.?use|already|EADDRINUSE)|EPERM/i
  },
  {
    category: 'database',
    pattern: /manual.?(migration|seed|setup)|database.*(not.?created|does.?not.?exist)|run.?migrations?/i
  }
];

/**
 * Mobile patterns — only active when iOS/Android project detected.
 */
const MOBILE_PATTERNS = {
  ios: [
    {
      category: 'signing',
      pattern: /signing|team.?id|provisioning.?profile|code.?sign|certificate|keychain|development.?team/i
    },
    {
      category: 'dependency',
      pattern: /pod.?install|cocoapods|pods?.*(not.?found|missing|outdated)/i
    },
    {
      category: 'toolchain',
      pattern: /xcode.*(select|install|not.?found|version)|xcodebuild.*(not.?found|error)/i
    },
    {
      category: 'simulator',
      pattern: /simulator.*(not|unavailable|missing)|no.*(device|simulator).*(available|found)/i
    }
  ],
  android: [
    {
      category: 'signing',
      pattern: /keystore.*(missing|not.?found|password)|signing.?config/i
    },
    {
      category: 'toolchain',
      pattern: /android.*(sdk|home).*(not.?found|missing|not.?set)|ANDROID_HOME|sdk.?manager/i
    },
    {
      category: 'dependency',
      pattern: /gradle.*(not.?found|version|wrapper)|build.?tools.*(missing|not.?found)/i
    }
  ]
};

/**
 * Instruction templates per category.
 * Each template provides actionable steps and an optional verify command.
 */
const TEMPLATES = {
  signing: {
    title: 'Configure code signing',
    steps: [
      'Open the project in Xcode',
      'Go to Signing & Capabilities',
      'Select your development team',
      'Verify provisioning profiles are valid'
    ],
    verifyCommand: 'xcodebuild -showBuildSettings 2>/dev/null | grep DEVELOPMENT_TEAM'
  },
  credentials: {
    title: 'Configure required credentials',
    steps: [
      'Check the error message for which key is missing',
      'Get the key from the service dashboard or provider',
      'Add to .env file: KEY_NAME=your-value',
      'Run ./devshop action to set values interactively'
    ],
    verifyCommand: null
  },
  permissions: {
    title: 'Fix permission or port conflict',
    steps: [
      'Check the error for which resource is blocked',
      'For port conflicts: stop the process using the port (lsof -i :PORT)',
      'For file permissions: check ownership and chmod as needed'
    ],
    verifyCommand: null
  },
  database: {
    title: 'Run database setup',
    steps: [
      'Check the error for which migration or seed is needed',
      'Run the database migration command for your project',
      'Verify the database is accessible'
    ],
    verifyCommand: null
  },
  dependency: {
    title: 'Install missing dependencies',
    steps: [
      'Run the install command shown in the error',
      'Verify with the build command for your platform'
    ],
    verifyCommand: null
  },
  toolchain: {
    title: 'Install or configure build tools',
    steps: [
      'Check the error for which tool is missing or misconfigured',
      'Install or update the required tool',
      'Verify the tool is accessible from your PATH'
    ],
    verifyCommand: null
  },
  simulator: {
    title: 'Configure simulator or device',
    steps: [
      'Open Xcode and go to Window > Devices and Simulators',
      'Download or create the required simulator runtime',
      'Verify simulator is available'
    ],
    verifyCommand: 'xcrun simctl list devices available'
  }
};

class InterventionClassifier {
  constructor(logger) {
    this.logger = logger;
    this.hasIOS = false;
    this.hasAndroid = false;
  }

  /**
   * Initialize project-type detection. Call once before classify().
   * @param {string} projectDir - Absolute path to the project directory
   */
  async init(projectDir) {
    try {
      this.hasIOS = !!(await detectIOSProject(projectDir));
    } catch {
      this.hasIOS = false;
    }
    try {
      this.hasAndroid = !!(await detectAndroidProject(projectDir));
    } catch {
      this.hasAndroid = false;
    }
  }

  /**
   * Classify an error as human-needed or code bug.
   * Pure pattern matching — zero cost, sync, no LLM calls.
   *
   * @param {string} error - The error/reason string from parking
   * @returns {{ classification: 'code_bug'|'human_needed', category: string|null, reason: string }}
   */
  classify(error) {
    if (!error || typeof error !== 'string') {
      return { classification: 'code_bug', category: null, reason: 'No error provided' };
    }

    // Check code bug patterns first — fast exit for known code issues
    for (const pattern of CODE_BUG_PATTERNS) {
      if (pattern.test(error)) {
        return { classification: 'code_bug', category: null, reason: 'Matched code bug pattern' };
      }
    }

    // Check universal patterns (all projects)
    for (const { category, pattern } of UNIVERSAL_PATTERNS) {
      if (pattern.test(error)) {
        return { classification: 'human_needed', category, reason: `Matched universal pattern: ${category}` };
      }
    }

    // Check mobile patterns (gated by project type)
    if (this.hasIOS) {
      for (const { category, pattern } of MOBILE_PATTERNS.ios) {
        if (pattern.test(error)) {
          return { classification: 'human_needed', category, reason: `Matched iOS pattern: ${category}` };
        }
      }
    }

    if (this.hasAndroid) {
      for (const { category, pattern } of MOBILE_PATTERNS.android) {
        if (pattern.test(error)) {
          return { classification: 'human_needed', category, reason: `Matched Android pattern: ${category}` };
        }
      }
    }

    // Default: treat as code bug (preserves existing behavior)
    return { classification: 'code_bug', category: null, reason: 'No intervention pattern matched' };
  }

  /**
   * Generate actionable human instructions for a classified error.
   *
   * @param {string} error - The original error string
   * @param {string} category - Category from classify() result
   * @returns {{ title: string, steps: string[], verifyCommand: string|null, category: string }}
   */
  generateInstructions(error, category) {
    const template = TEMPLATES[category];
    if (!template) {
      return {
        title: 'Manual intervention required',
        steps: ['Review the error message and take appropriate action'],
        verifyCommand: null,
        category
      };
    }

    // Customize steps based on error content
    const steps = [...template.steps];

    // For credentials, try to extract the specific key name
    if (category === 'credentials') {
      const keyMatch = error.match(/[`'"]([\w_]{3,})[`'"].*?(?:is.?not.?set|missing|required|undefined|not.?found)/i)
        || error.match(/(?:missing|required|undefined|not.?found).*?[`'"]([\w_]{3,})[`'"]/i)
        || error.match(/\b([A-Z][A-Z0-9_]{2,})\b.*?(?:is.?not.?set|missing|required|undefined)/i);
      if (keyMatch) {
        const key = keyMatch[1] || keyMatch[2];
        steps[2] = `Add to .env file: ${key}=your-value`;
      }
    }

    return {
      title: template.title,
      steps,
      verifyCommand: template.verifyCommand,
      category
    };
  }
}

module.exports = { InterventionClassifier, CODE_BUG_PATTERNS, UNIVERSAL_PATTERNS, MOBILE_PATTERNS, TEMPLATES };
