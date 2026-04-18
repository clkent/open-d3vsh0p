const readline = require('readline');
const { ActionResolver } = require('../roadmap/action-resolver');

async function actionCommand(project, config) {
  console.log('');
  console.log('=== Action Required ===');
  console.log(`  Project: ${project.name} (${project.id})`);
  console.log('');

  const resolver = new ActionResolver(config.projectDir);

  let result;
  try {
    result = await resolver.analyze();
  } catch (err) {
    if (err.code === 'NO_ROADMAP') {
      console.error('  No roadmap.md found in this project.');
      console.error('  Run ./devshop plan first to create one.');
      return 1;
    }
    throw err;
  }

  if (result.items.length === 0) {
    if (result.deferredCount > 0) {
      console.log(`  No currently actionable items. ${result.deferredCount} item(s) waiting in future phases.`);
    } else {
      console.log('  No pending HUMAN-tagged items. Nothing to do!');
    }
    console.log('');
    return 0;
  }

  // Display summary grouped by phase
  console.log(`  ${result.items.length} item(s) requiring action:`);
  console.log('');

  // Group items by phase
  const byPhase = new Map();
  for (const item of result.items) {
    const key = item.phaseNumber;
    if (!byPhase.has(key)) {
      byPhase.set(key, { phaseNumber: item.phaseNumber, phaseLabel: item.phaseLabel, items: [] });
    }
    byPhase.get(key).items.push(item);
  }

  for (const phase of byPhase.values()) {
    console.log(`  Phase ${phase.phaseNumber}: ${phase.phaseLabel}`);
    for (const item of phase.items) {
      const TYPE_LABELS = { env_setup: 'ENV SETUP', intervention: 'INTERVENTION', manual: 'MANUAL' };
      const typeLabel = TYPE_LABELS[item.actionType] || 'MANUAL';
      const statusLabel = item.status === 'parked' ? ' (parked)' : '';
      console.log(`    [${typeLabel}] ${item.id} — ${item.description}${statusLabel}`);
      console.log(`        Group ${item.groupLetter}: ${item.groupLabel}`);
    }
    console.log('');
  }

  if (result.deferredCount > 0) {
    console.log(`  ${result.deferredCount} more item(s) waiting in future phases.`);
    console.log('');
  }

  // Interactive resolution
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (prompt) => new Promise((resolve) => {
    rl.question(prompt, resolve);
  });

  try {
    for (const item of result.items) {
      console.log(`  --- ${item.id} ---`);
      console.log(`  ${item.description}`);
      console.log(`  Phase ${item.phaseNumber}: ${item.phaseLabel} > Group ${item.groupLetter}: ${item.groupLabel}`);
      console.log('');

      if (item.actionType === 'intervention' && item.interventionDetails) {
        await handleIntervention(item, resolver, question);
      } else if (item.actionType === 'env_setup' && item.envDetails) {
        await handleEnvSetup(item, resolver, question, rl);
      } else {
        await handleManual(item, resolver, question);
      }

      console.log('');
    }
  } catch (err) {
    // Ctrl+C or stream close
    if (err.message === 'readline was closed') {
      console.log('\n  Exiting.');
      return 0;
    }
    throw err;
  } finally {
    rl.close();
  }

  console.log('  Done!');
  console.log('');
  return 0;
}

async function handleEnvSetup(item, resolver, question, rl) {
  const { missingKeys, alreadySet } = item.envDetails;

  if (alreadySet.length > 0) {
    console.log(`  Already configured: ${alreadySet.join(', ')}`);
  }

  if (missingKeys.length === 0) {
    console.log('  All keys are already set!');
    const answer = await question('  Mark as complete? (y/n): ');
    if (answer.trim().toLowerCase() === 'y') {
      await resolver.resolveItem(item.id);
      console.log(`  Marked ${item.id} as complete.`);
    }
    return;
  }

  console.log(`  ${missingKeys.length} key(s) need values:`);
  console.log('');

  const keyValues = {};
  let enteredCount = 0;

  for (const keyInfo of missingKeys) {
    console.log(`  ${keyInfo.key}`);
    if (keyInfo.comment) {
      console.log(`    ${keyInfo.comment}`);
    }
    if (keyInfo.signupUrl) {
      console.log(`    Sign up: ${keyInfo.signupUrl}`);
    }

    // Disable echo for secret input
    const wasRaw = process.stdin.isRaw;
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }

    let value = '';
    try {
      value = await readSecretLine(rl, '    Enter value (or Enter to skip): ');
    } finally {
      if (process.stdin.isTTY && wasRaw !== undefined) {
        process.stdin.setRawMode(wasRaw || false);
      }
    }

    if (value.trim()) {
      keyValues[keyInfo.key] = value.trim();
      enteredCount++;
    } else {
      console.log('    Skipped.');
    }
    console.log('');
  }

  if (enteredCount > 0) {
    await resolver.writeEnvValues(keyValues);
    console.log(`  Written ${enteredCount} key(s) to .env`);
  }

  const answer = await question(`  Mark ${item.id} as complete? (y/n): `);
  if (answer.trim().toLowerCase() === 'y') {
    await resolver.resolveItem(item.id);
    console.log(`  Marked ${item.id} as complete.`);
  }
}

async function handleIntervention(item, resolver, question) {
  const instr = item.interventionDetails;
  console.log(`  Category: ${instr.category}`);
  console.log(`  ${instr.title}`);
  console.log('');
  console.log('  Steps:');
  for (let i = 0; i < instr.steps.length; i++) {
    console.log(`    ${i + 1}. ${instr.steps[i]}`);
  }
  if (instr.verifyCommand) {
    console.log('');
    console.log(`  Verify: ${instr.verifyCommand}`);
  }
  console.log('');

  const answer = await question('  Have you completed this? (y/n): ');
  if (answer.trim().toLowerCase() === 'y') {
    await resolver.resolveIntervention(item.id);
    console.log(`  Marked ${item.id} as complete.`);
  } else {
    console.log('  Skipped.');
  }
}

async function handleManual(item, resolver, question) {
  const answer = await question('  Have you completed this? (y/n): ');
  if (answer.trim().toLowerCase() === 'y') {
    await resolver.resolveItem(item.id);
    console.log(`  Marked ${item.id} as complete.`);
  } else {
    console.log('  Skipped.');
  }
}

/**
 * Read a line of input without echoing characters (for secret values).
 * Falls back to normal readline if not a TTY.
 */
function readSecretLine(rl, prompt) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      // Not a TTY — just use normal question
      rl.question(prompt, resolve);
      return;
    }

    process.stdout.write(prompt);

    let input = '';
    const onData = (key) => {
      const ch = key.toString();

      if (ch === '\n' || ch === '\r' || ch === '\r\n') {
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(input);
      } else if (ch === '\u0003') {
        // Ctrl+C
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        reject(new Error('readline was closed'));
      } else if (ch === '\u007f' || ch === '\b') {
        // Backspace
        if (input.length > 0) {
          input = input.slice(0, -1);
        }
      } else if (ch.charCodeAt(0) >= 32) {
        input += ch;
      }
    };

    process.stdin.on('data', onData);
  });
}

module.exports = { actionCommand };
