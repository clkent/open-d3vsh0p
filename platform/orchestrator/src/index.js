const { parseArgs } = require('node:util');
const path = require('path');
const fs = require('fs/promises');
const { resolveProject, loadRegistry, saveRegistry, DEVSHOP_ROOT } = require('./infra/registry');

const TEMPLATES_DIR = path.join(DEVSHOP_ROOT, 'templates', 'agents');
const ACTIVE_AGENTS_DIR = path.join(DEVSHOP_ROOT, 'active-agents');

const COMMANDS = ['kickoff', 'run', 'plan', 'talk', 'pair', 'status', 'schedule', 'cadence', 'action', 'recover', 'watch', 'report', 'security', 'api', 'help'];

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      budget: { type: 'string', default: '30' },
      'time-limit': { type: 'string', default: '7' },
      resume: { type: 'boolean', default: false },
      fresh: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      requirements: { type: 'string' },
      window: { type: 'string' },
      type: { type: 'string' },
      'no-consolidate': { type: 'boolean', default: false },
      'watch-port': { type: 'string' },
      port: { type: 'string' },
      status: { type: 'boolean', default: false },
      focus: { type: 'string' },
      timeout: { type: 'string' },
      schedule: { type: 'string' },
      unschedule: { type: 'boolean', default: false },
      design: { type: 'boolean', default: false },
      watch: { type: 'boolean', default: true }
    }
  });

  const [command, ...rest] = positionals;

  if (!command || command === 'help') {
    printUsage();
    process.exit(0);
  }

  if (!COMMANDS.includes(command)) {
    console.error(`Unknown command: ${command}`);
    printUsage();
    process.exit(1);
  }

  // kickoff requires a project-name positional arg
  if (command === 'kickoff') {
    const projectName = rest[0];
    if (!projectName) {
      console.error('Error: project-name is required');
      console.error('Usage: ./devshop kickoff <project-name>');
      process.exit(1);
    }
    const registry = await loadRegistry();
    const { kickoffCommand } = require('./commands/kickoff');
    const exitCode = await kickoffCommand(projectName, registry, saveRegistry, { design: values.design });
    process.exit(exitCode);
  }

  // api is a standalone server command — no project-id needed
  if (command === 'api') {
    const { apiCommand } = require('./commands/api');
    const exitCode = await apiCommand(values);
    process.exit(exitCode);
  }

  // schedule and cadence have subcommands: schedule <subcommand> <project-id>
  let projectId, subcommand;
  if (command === 'schedule' || command === 'cadence') {
    subcommand = rest[0];
    projectId = rest[1];

    if (!subcommand) {
      console.error(`Error: ${command} requires a subcommand`);
      printUsage();
      process.exit(1);
    }

    if (!projectId) {
      console.error('Error: project-id is required');
      printUsage();
      process.exit(1);
    }
  } else {
    projectId = rest[0];

    if (command !== 'help' && !projectId) {
      console.error('Error: project-id is required');
      printUsage();
      process.exit(1);
    }
  }

  // Load project from registry (supports full ID or just the name portion)
  const registry = await loadRegistry();
  const project = resolveProject(registry, projectId);
  if (!project) {
    process.exit(1);
  }

  // Verify project directory exists
  try {
    await fs.access(project.projectDir);
  } catch {
    console.error(`Project directory not found: ${project.projectDir}`);
    process.exit(1);
  }

  // Build config
  const config = {
    projectId: project.id,
    projectDir: project.projectDir,
    githubRepo: project.githubRepo,
    budgetLimitUsd: parseFloat(values.budget),
    timeLimitMs: parseFloat(values['time-limit']) * 3600000,
    resume: values.resume,
    fresh: values.fresh,
    dryRun: values['dry-run'],
    requirements: values.requirements ? values.requirements.split(',').map(s => s.trim()) : null,
    window: values.window || null,
    templatesDir: TEMPLATES_DIR,
    activeAgentsDir: path.join(ACTIVE_AGENTS_DIR, project.id),
    noConsolidate: values['no-consolidate'],
    preview: project.preview || null,
    broadcastPort: values['watch-port'] ? parseInt(values['watch-port'], 10)
      : values.port ? parseInt(values.port, 10) : undefined,
    reportStatus: values.status || false,
    watch: values.watch || false
  };

  // Dispatch to command handler
  let exitCode = 0;

  switch (command) {
    case 'run': {
      const { runCommand } = require('./commands/run');
      exitCode = await runCommand(project, config, registry, saveRegistry);
      break;
    }
    case 'plan': {
      const { planCommand } = require('./commands/plan');
      exitCode = await planCommand(project, config);
      break;
    }
    case 'talk': {
      const { talkCommand } = require('./commands/talk');
      exitCode = await talkCommand(project, config);
      break;
    }
    case 'pair': {
      const { pairCommand } = require('./commands/pair');
      exitCode = await pairCommand(project, config);
      break;
    }
    case 'status': {
      const { statusCommand } = require('./commands/status');
      exitCode = await statusCommand(project, config);
      break;
    }
    case 'schedule': {
      const { scheduleCommand } = require('./commands/schedule');
      exitCode = await scheduleCommand(project, config, subcommand);
      break;
    }
    case 'cadence': {
      const { cadenceCommand } = require('./commands/cadence');
      exitCode = await cadenceCommand(project, config, subcommand, {
        type: values.type,
        dryRun: values['dry-run']
      });
      break;
    }
    case 'action': {
      const { actionCommand } = require('./commands/action');
      exitCode = await actionCommand(project, config);
      break;
    }
    case 'recover': {
      const { recoverCommand } = require('./commands/recover');
      exitCode = await recoverCommand(project, config);
      break;
    }
    case 'watch': {
      const { watchCommand } = require('./commands/watch');
      exitCode = await watchCommand(project, config);
      break;
    }
    case 'report': {
      const { reportCommand } = require('./commands/report');
      exitCode = await reportCommand(project, config);
      break;
    }
    case 'security': {
      const { securityCommand } = require('./commands/security');
      const securityConfig = {
        ...config,
        focus: values.focus || null,
        schedule: values.schedule || null,
        unschedule: values.unschedule || false,
        securityBudget: values.budget !== '30' ? parseFloat(values.budget) : null,
        securityTimeout: values.timeout ? parseFloat(values.timeout) : null
      };
      exitCode = await securityCommand(project, securityConfig);
      break;
    }
  }

  process.exit(exitCode);
}

function printUsage() {
  console.log(`
DevShop Orchestrator - Spec-driven agent development

Usage:
  ./devshop <command> [project] [options]

  Project can be the full ID (proj-001-garden-planner) or just the name (garden-planner).

Commands:
  kickoff <project-name> [--design]  Start a new project (scaffold → Q&A with Riley → specs)
  plan <project>                    Brain dump with Riley → specs → roadmap
  talk <project>                    Talk to Riley mid-project (update specs/roadmap)
  pair <project>                    Pair with Morgan to diagnose and fix issues
  run <project>                     Execute roadmap (parallel agents)
  status <project>                 Show project progress, phases, consumption
  schedule <sub> <project>         Manage automated scheduling (install/remove/pause/resume/status/dry-run)
  cadence <sub> <project>          Run maintenance cadences (run/status)
  action <project>                 Resolve HUMAN-tagged roadmap items interactively
  recover <project>                Clean up orphaned worktrees, stale branches, inconsistent state
  watch <project>                  Watch a running session in real time (connects to broadcast server)
  report <project>                 Report a bug or request a feature (queued for between-phase processing)
  security <project>               Run a standalone security scan (Casey)
  api                               Start REST API server for programmatic access
  help                              Show this help message

Session commands (during kickoff, plan, talk, pair):
  go        (kickoff only) Tell Riley to create specs and roadmap
  push      Commit and push changes to GitHub via PR
  done      Save session and exit

Options:
  --budget <usd>           Session budget limit (default: 30)
  --time-limit <hours>     Session time limit (default: 7)
  --resume                 Resume a previously interrupted session
  --fresh                  Start a fresh session (ignore saved state)
  --requirements <ids>     Comma-separated requirement IDs to work on
  --window <name>          Run in a specific time window (night/morning/day/techdebt)
  --type <type>            Cadence type for cadence run (weekly/monthly)
  --dry-run                Preview without making changes
  --no-consolidate         Skip auto-consolidation of session branch to main
  --no-watch               Hide live agent activity (shown by default)
  --watch-port <port>      Broadcast server port (default: 3100)
  --port <port>            Port for watch command to connect to (default: 3100)
  --status                 Show report queue status (for report command)
  --focus <areas>          Security scan focus (comma-separated: secrets,deps,injection,auth,config)
  --timeout <minutes>      Security scan timeout in minutes (default: 5)
  --schedule <freq>        Schedule recurring security scans (weekly)
  --unschedule             Remove scheduled security scans
  --design                 Install Impeccable design skills for frontend projects (kickoff only)

Examples:
  ./devshop kickoff my-app
  ./devshop kickoff my-app --design
  ./devshop plan my-app
  ./devshop run my-app
  ./devshop run my-app --budget 10 --time-limit 4
  ./devshop run my-app --window night
  ./devshop run my-app --requirements user-authentication
  ./devshop status my-app
  ./devshop talk my-app
  ./devshop pair my-app
  ./devshop pair my-app --resume
  ./devshop schedule install my-app
  ./devshop schedule pause my-app
  ./devshop schedule resume my-app
  ./devshop schedule status my-app
  ./devshop schedule dry-run my-app
  ./devshop schedule remove my-app
  ./devshop cadence run my-app --type weekly
  ./devshop cadence run my-app --type monthly
  ./devshop cadence status my-app
  ./devshop watch my-app
  ./devshop watch my-app --port 3200
  ./devshop report my-app
  ./devshop report my-app --status
  ./devshop security my-app
  ./devshop security my-app --focus secrets,deps
  ./devshop security my-app --budget 5 --timeout 10
  ./devshop security my-app --schedule weekly
  ./devshop security my-app --unschedule
  DEVSHOP_API_TOKEN=secret ./devshop api
  DEVSHOP_API_TOKEN=secret ./devshop api --port 3200
`);
}

// Exported for testing
module.exports = { resolveProject };

main().catch(err => {
  console.error('');
  console.error('Fatal error:', err.message);
  if (process.env.DEBUG) {
    console.error(err.stack);
  }
  process.exit(2);
});
