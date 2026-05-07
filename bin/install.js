#!/usr/bin/env node
/**
 * pr-autopilot installer — copies SKILL.md into the Claude Code skills
 * directory so the skill becomes available as /pr-autopilot.
 *
 * Usage:
 *   npx pr-autopilot                # install user-level (~/.claude/skills/)
 *   npx pr-autopilot --project      # install project-level (./.claude/skills/)
 *   npx pr-autopilot --uninstall    # remove the installed copy
 *   npx pr-autopilot --dry-run      # show what would happen, don't write
 *   npx pr-autopilot --help
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const SKILL_NAME = 'pr-autopilot';
const args = new Set(process.argv.slice(2));

if (args.has('--help') || args.has('-h')) {
  process.stdout.write(
    [
      'pr-autopilot — Claude Code skill installer',
      '',
      'Usage:',
      '  npx pr-autopilot                Install for the current user',
      '  npx pr-autopilot --project      Install into ./.claude/skills/ (project-local)',
      '  npx pr-autopilot --uninstall    Remove the installed copy',
      '  npx pr-autopilot --dry-run      Show what would be written',
      '',
      'After install, run /reload-plugins inside Claude Code (or restart) so',
      'the skill is picked up.',
      '',
    ].join('\n')
  );
  process.exit(0);
}

const projectScope = args.has('--project');
const dryRun = args.has('--dry-run');
const uninstall = args.has('--uninstall');

const targetRoot = projectScope
  ? path.join(process.cwd(), '.claude', 'skills', SKILL_NAME)
  : path.join(os.homedir(), '.claude', 'skills', SKILL_NAME);

const targetFile = path.join(targetRoot, 'SKILL.md');

// SKILL.md sits next to package.json — bin/install.js lives one level deeper.
const sourceFile = path.resolve(__dirname, '..', 'SKILL.md');

function fail(msg) {
  process.stderr.write(`[31m✖ ${msg}[0m\n`);
  process.exit(1);
}

function ok(msg) {
  process.stdout.write(`[32m✔ ${msg}[0m\n`);
}

function info(msg) {
  process.stdout.write(`  ${msg}\n`);
}

if (uninstall) {
  if (!fs.existsSync(targetFile)) {
    info(`Nothing to remove — ${targetFile} does not exist.`);
    process.exit(0);
  }
  if (dryRun) {
    info(`Would remove ${targetRoot}`);
    process.exit(0);
  }
  fs.rmSync(targetRoot, { recursive: true, force: true });
  ok(`Removed ${targetRoot}`);
  process.exit(0);
}

if (!fs.existsSync(sourceFile)) {
  fail(`Source SKILL.md not found at ${sourceFile}`);
}

if (dryRun) {
  info(`Would copy: ${sourceFile}`);
  info(`         → ${targetFile}`);
  process.exit(0);
}

fs.mkdirSync(targetRoot, { recursive: true });
fs.copyFileSync(sourceFile, targetFile);

ok(`Installed ${SKILL_NAME} → ${targetFile}`);
info('Run /reload-plugins in Claude Code (or restart the session) to load it.');
info(`Then try:  /${SKILL_NAME} --auto`);
