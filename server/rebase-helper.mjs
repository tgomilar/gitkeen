#!/usr/bin/env node
/**
 * Stands in for the editor that `git rebase -i` would open.
 *
 * Git is told to run this file in two roles:
 *
 *   sequence  rewrite the todo list, turning the selected commits into one
 *   message   write the final commit message
 *
 * Doing it this way means the user never sees an editor, and Gitalia keeps
 * using real Git rather than reimplementing what rebase does.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const role = process.argv[2];
const target = process.argv[3];

if (!role || !target) {
  console.error('rebase-helper: expected a role and a file path');
  process.exit(1);
}

if (role === 'sequence') {
  const count = Number(process.env.GITALIA_SQUASH_COUNT);
  if (!Number.isInteger(count) || count < 2) {
    console.error('rebase-helper: GITALIA_SQUASH_COUNT must be 2 or more');
    process.exit(1);
  }

  const lines = readFileSync(target, 'utf8').split('\n');
  let picked = 0;
  const rewritten = lines.map((line) => {
    // Only real todo commands count; comments and blanks are left alone.
    if (!/^pick\s/.test(line)) return line;
    picked++;
    // The oldest selected commit keeps its pick and absorbs the rest.
    if (picked === 1 || picked > count) return line;
    return line.replace(/^pick\s/, 'squash ');
  });

  if (picked < count) {
    console.error(`rebase-helper: expected at least ${count} commits in the todo list, found ${picked}`);
    process.exit(1);
  }

  writeFileSync(target, rewritten.join('\n'));
  process.exit(0);
}

if (role === 'message') {
  const source = process.env.GITALIA_SQUASH_MESSAGE_FILE;
  if (!source) {
    console.error('rebase-helper: GITALIA_SQUASH_MESSAGE_FILE is not set');
    process.exit(1);
  }
  writeFileSync(target, readFileSync(source, 'utf8'));
  process.exit(0);
}

console.error(`rebase-helper: unknown role "${role}"`);
process.exit(1);
