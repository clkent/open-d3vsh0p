const readline = require('readline');
const path = require('path');
const { readQueue, appendReport } = require('../runners/report-processor');

async function reportCommand(project, config) {
  const queuePath = path.join(config.activeAgentsDir, 'orchestrator', 'reported-issues.json');

  // Status mode: show existing reports
  if (config.reportStatus) {
    return showStatus(queuePath, project);
  }

  // Interactive mode: submit a new report
  return submitReport(queuePath, project);
}

async function showStatus(queuePath, project) {
  const queue = await readQueue(queuePath);

  if (queue.length === 0) {
    console.log('');
    console.log(`  No reports for ${project.id}.`);
    console.log('');
    return 0;
  }

  console.log('');
  console.log(`  Reports for ${project.id}:`);
  console.log('');
  console.log('  ' + 'ID'.padEnd(10) + 'Type'.padEnd(10) + 'Status'.padEnd(12) + 'Outcome'.padEnd(16) + 'Description');
  console.log('  ' + '-'.repeat(70));

  for (const r of queue) {
    const desc = r.description.slice(0, 40).replace(/\n/g, ' ');
    const outcome = r.outcome || r.error || '';
    console.log(
      '  ' +
      r.id.padEnd(10) +
      r.type.padEnd(10) +
      r.status.padEnd(12) +
      outcome.slice(0, 14).padEnd(16) +
      desc
    );
  }

  console.log('');
  return 0;
}

async function submitReport(queuePath, project) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const ask = (question) => new Promise((resolve) => {
    rl.question(question, resolve);
  });

  console.log('');
  console.log(`  === Report an Issue — ${project.name} ===`);
  console.log('');

  // Ask for type
  const typeInput = await ask('  Type (bug/feature): ');
  const type = typeInput.trim().toLowerCase();

  if (type !== 'bug' && type !== 'feature') {
    console.error('  Error: type must be "bug" or "feature"');
    rl.close();
    return 1;
  }

  // Ask for description
  console.log('');
  console.log('  Describe the issue (press Enter twice to submit):');
  console.log('');

  const lines = [];
  let lastWasEmpty = false;

  const description = await new Promise((resolve) => {
    const promptLine = () => {
      rl.question('  > ', (line) => {
        if (line.trim() === '' && lastWasEmpty) {
          resolve(lines.join('\n'));
          return;
        }
        lastWasEmpty = line.trim() === '';
        lines.push(line);
        promptLine();
      });
    };
    promptLine();
  });

  if (!description.trim()) {
    console.error('  Error: description cannot be empty');
    rl.close();
    return 1;
  }

  const report = await appendReport(queuePath, { type, description: description.trim() });

  console.log('');
  console.log(`  Report submitted!`);
  console.log(`    ID:   ${report.id}`);
  console.log(`    Type: ${report.type}`);
  console.log(`    Status: pending`);
  console.log('');
  console.log('  It will be processed between orchestrator phases.');
  console.log('  Check status with: ./devshop report ' + project.id.replace(/^proj-\d+-/, '') + ' --status');
  console.log('');

  rl.close();
  return 0;
}

module.exports = { reportCommand };
