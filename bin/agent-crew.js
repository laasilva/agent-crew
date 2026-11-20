#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ROLES = ['planner', 'designer', 'builder', 'fixer'];
const START = '<!-- agent-crew:start -->';
const END = '<!-- agent-crew:end -->';
// Every role file says this, so uninstall can tell our files from someone else's with the same name.
const OURS = 'in a crew of agents that share one project';

const HELP = `agent-crew: a planner, a designer, builders and a fixer for Claude Code

Usage:
  agent-crew init [options]      Install the crew into a project
  agent-crew uninstall [options] Remove what init installed
  agent-crew help                Show this help

Options:
  --dir <path>     The project folder (default: the current folder)
  --builders <n>   How many builders the roster lists (default: 2)
  --no-designer    Leave the designer out
  --no-fixer       Leave the fixer out
  --force          Replace files that already exist
  --dry-run        Show what would change, and change nothing
`;

function parse(argv) {
  const options = { dir: process.cwd(), builders: 2, designer: true, fixer: true, force: false, dryRun: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dir') options.dir = path.resolve(need(argv[++i], '--dir'));
    else if (arg === '--builders') options.builders = count(need(argv[++i], '--builders'));
    else if (arg === '--no-designer') options.designer = false;
    else if (arg === '--no-fixer') options.fixer = false;
    else if (arg === '--force') options.force = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg.startsWith('--')) fail(`Unknown option: ${arg}`);
    else rest.push(arg);
  }
  return { command: rest[0] || 'help', options };
}

function need(value, name) {
  if (value === undefined || value.startsWith('--')) fail(`${name} needs a value.`);
  return value;
}

function count(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 9) fail('--builders takes a whole number from 1 to 9.');
  return n;
}

function fail(message) {
  console.error(message);
  console.error('Run "agent-crew help" for the options.');
  process.exit(1);
}

function rolesFor(options) {
  return ROLES.filter((role) => (role !== 'designer' || options.designer) && (role !== 'fixer' || options.fixer));
}

function sessions(options) {
  const list = [{ name: 'planner', role: 'planner', worktree: false }];
  if (options.designer) list.push({ name: 'designer', role: 'designer', worktree: true });
  for (let i = 1; i <= options.builders; i++) list.push({ name: `builder-${i}`, role: 'builder', worktree: true });
  if (options.fixer) list.push({ name: 'fixer', role: 'fixer', worktree: true });
  return list;
}

function block(options) {
  const rows = sessions(options).map((s) => `| ${s.name} | ${s.role} |`).join('\n');
  return [
    START,
    '## Agent crew',
    '',
    'A crew of agents works on this project, each in its own session. Every agent follows @.claude/crew/PROTOCOL.md.',
    '',
    '| Session | Role |',
    '| --- | --- |',
    rows,
    '',
    'Your session\'s name is your worktree\'s name, and the planner is the session without one. Sign issue and pull request comments with it.',
    END,
  ].join('\n');
}

function write(file, content, options, log) {
  const shown = path.relative(options.dir, file) || file;
  if (fs.existsSync(file) && !options.force) {
    if (fs.readFileSync(file, 'utf8') === content) {
      log.push(`  same     ${shown}`);
    } else {
      log.push(`  kept     ${shown} (it already exists, so use --force to replace it)`);
    }
    return;
  }
  log.push(`  ${fs.existsSync(file) ? 'replaced' : 'created '} ${shown}`);
  if (options.dryRun) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function withoutBlock(text) {
  const start = text.indexOf(START);
  const end = text.indexOf(END);
  if (start < 0 || end < start) return text;
  return (text.slice(0, start).trimEnd() + '\n\n' + text.slice(end + END.length).trimStart()).trim() + '\n';
}

function init(options) {
  if (!fs.existsSync(options.dir)) fail(`There's no folder at ${options.dir}.`);
  const log = [];

  for (const role of rolesFor(options)) {
    const content = fs.readFileSync(path.join(ROOT, 'agents', `${role}.md`), 'utf8');
    write(path.join(options.dir, '.claude', 'agents', `${role}.md`), content, options, log);
  }

  const protocol = fs.readFileSync(path.join(ROOT, 'templates', 'PROTOCOL.md'), 'utf8');
  write(path.join(options.dir, '.claude', 'crew', 'PROTOCOL.md'), protocol, options, log);

  // CLAUDE.md is the owner's file, so only the marked block is ever touched.
  const claudeFile = path.join(options.dir, 'CLAUDE.md');
  const before = fs.existsSync(claudeFile) ? fs.readFileSync(claudeFile, 'utf8') : '';
  const base = withoutBlock(before).trimEnd();
  const after = (base ? base + '\n\n' : '') + block(options) + '\n';
  if (after === before) {
    log.push('  same     CLAUDE.md');
  } else {
    log.push(`  ${before ? 'updated ' : 'created '} CLAUDE.md (the crew's section)`);
    if (!options.dryRun) fs.writeFileSync(claudeFile, after);
  }

  console.log(options.dryRun ? 'Dry run. Nothing was changed.\n' : 'The crew is installed.\n');
  console.log(log.join('\n'));
  console.log('\nNext:');
  console.log('  1. Commit .claude/ and CLAUDE.md, so that every worktree has them.');
  console.log('  2. Start one session per agent, each in its own terminal:\n');
  for (const s of sessions(options)) {
    console.log(`       claude --agent ${s.role}${s.worktree ? ` --worktree ${s.name}` : ''}`);
  }
  console.log('\n  3. Talk to the planner. It writes the issues and routes the work.');
}

function uninstall(options) {
  const log = [];
  const remove = (file) => {
    if (!fs.existsSync(file)) return;
    log.push(`  removed  ${path.relative(options.dir, file)}`);
    if (!options.dryRun) fs.rmSync(file);
  };

  for (const role of ROLES) {
    const file = path.join(options.dir, '.claude', 'agents', `${role}.md`);
    if (!fs.existsSync(file)) continue;
    if (fs.readFileSync(file, 'utf8').includes(OURS) || options.force) remove(file);
    else log.push(`  kept     ${path.relative(options.dir, file)} (it isn't one of ours)`);
  }

  remove(path.join(options.dir, '.claude', 'crew', 'PROTOCOL.md'));
  const crewDir = path.join(options.dir, '.claude', 'crew');
  if (!options.dryRun && fs.existsSync(crewDir) && fs.readdirSync(crewDir).length === 0) fs.rmdirSync(crewDir);

  const claudeFile = path.join(options.dir, 'CLAUDE.md');
  if (fs.existsSync(claudeFile)) {
    const before = fs.readFileSync(claudeFile, 'utf8');
    const after = withoutBlock(before);
    if (after !== before) {
      log.push('  updated  CLAUDE.md (the crew\'s section is gone)');
      if (!options.dryRun) fs.writeFileSync(claudeFile, after);
    }
  }

  console.log(log.length ? (options.dryRun ? 'Dry run. Nothing was changed.\n' : 'The crew is removed.\n') + '\n' + log.join('\n') : 'Nothing to remove.');
}

const { command, options } = parse(process.argv.slice(2));
if (command === 'init') init(options);
else if (command === 'uninstall') uninstall(options);
else if (command === 'help') console.log(HELP);
else fail(`Unknown command: ${command}`);
