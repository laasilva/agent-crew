'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const cli = path.join(__dirname, '..', 'bin', 'agent-crew.js');
const run = (dir, ...args) => execFileSync('node', [cli, ...args, '--dir', dir], { encoding: 'utf8' });
const fresh = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agent-crew-'));
const read = (dir, file) => fs.readFileSync(path.join(dir, file), 'utf8');
const has = (dir, file) => fs.existsSync(path.join(dir, file));

// A fresh project gets every role, the protocol and a CLAUDE.md.
let dir = fresh();
run(dir, 'init');
for (const role of ['planner', 'designer', 'builder', 'fixer']) assert(has(dir, `.claude/agents/${role}.md`), role);
assert(has(dir, '.claude/crew/PROTOCOL.md'));
assert(read(dir, 'CLAUDE.md').includes('@.claude/crew/PROTOCOL.md'));
assert(read(dir, 'CLAUDE.md').includes('| builder-2 | builder |'));

// The owner's CLAUDE.md is kept, and running init again doesn't repeat the section.
dir = fresh();
fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# My project\n\nMy rules.\n');
run(dir, 'init', '--builders', '3', '--no-designer');
run(dir, 'init', '--builders', '3', '--no-designer');
let text = read(dir, 'CLAUDE.md');
assert(text.startsWith('# My project\n\nMy rules.\n'));
assert.strictEqual(text.split('agent-crew:start').length, 2);
assert(text.includes('builder-3') && !text.includes('| designer |'));
assert(!has(dir, '.claude/agents/designer.md'));

// A file that's already there is kept without --force.
dir = fresh();
fs.mkdirSync(path.join(dir, '.claude/agents'), { recursive: true });
fs.writeFileSync(path.join(dir, '.claude/agents/planner.md'), 'mine');
assert(run(dir, 'init').includes('kept'));
assert.strictEqual(read(dir, '.claude/agents/planner.md'), 'mine');
run(dir, 'init', '--force');
assert.notStrictEqual(read(dir, '.claude/agents/planner.md'), 'mine');

// A dry run changes nothing.
dir = fresh();
run(dir, 'init', '--dry-run');
assert(!has(dir, '.claude') && !has(dir, 'CLAUDE.md'));

// Uninstall removes ours, and leaves the owner's text and other agents alone.
dir = fresh();
fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# My project\n');
run(dir, 'init');
fs.writeFileSync(path.join(dir, '.claude/agents/reviewer.md'), 'mine');
fs.writeFileSync(path.join(dir, '.claude/agents/fixer.md'), 'my own fixer');
run(dir, 'uninstall');
assert.strictEqual(read(dir, 'CLAUDE.md'), '# My project\n');
assert(!has(dir, '.claude/agents/planner.md') && !has(dir, '.claude/crew'));
assert(has(dir, '.claude/agents/reviewer.md'));
assert.strictEqual(read(dir, '.claude/agents/fixer.md'), 'my own fixer');

console.log('All installer tests passed.');
