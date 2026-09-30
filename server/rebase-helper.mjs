#!/usr/bin/env node
/**
 * Stands in for the editor that `git rebase -i` would open.
 *
 * Git is told to run this file in two roles:
 *
 *   sequence  rewrite the todo list into the plan Gitkeen decided on
 *   message   write the final commit message
 *
 * Doing it this way means the user never sees an editor, and Gitkeen keeps
 * using real Git rather than reimplementing what rebase does.
 *
 * The sequence role takes its plan from the environment rather than working
 * it out here. GITKEEN_TODO holds one command per selected commit, oldest
 * first, as newline-separated `<command> <sha>` pairs. The helper checks that
 * the todo list Git produced holds exactly the commits the plan names, in the
 * order it expects, and refuses rather than guessing if it does not: writing
 * a todo list that does not match the plan is how a rebase silently loses a
 * commit.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const role = process.argv[2];
const target = process.argv[3];

if (!role || !target) {
  console.error('rebase-helper: expected a role and a file path');
  process.exit(1);
}

if (role === 'sequence') {
  const plan = (process.env.GITKEEN_TODO ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [command, sha] = line.split(/\s+/);
      return { command, sha };
    });

  if (plan.length === 0) {
    console.error('rebase-helper: GITKEEN_TODO is empty');
    process.exit(1);
  }

  const lines = readFileSync(target, 'utf8').split('\n');

  // The commits Git listed, oldest first, in the order it means to apply them.
  const picks = [];
  for (const line of lines) {
    const match = /^pick\s+(\S+)/.exec(line);
    if (match) picks.push(match[1]);
  }

  // Git abbreviates in the todo list, so the plan's full hashes are matched
  // by prefix in whichever direction the abbreviation runs.
  const same = (a, b) => a.startsWith(b) || b.startsWith(a);

  // The plan must name exactly the commits Git listed, no more and no fewer.
  // Order is deliberately not compared: reordering is the whole point, so the
  // plan's order is what Git is told to use. What must hold is that no commit
  // was invented and none quietly went missing.
  if (picks.length !== plan.length) {
    console.error(
      `rebase-helper: the todo list holds ${picks.length} commits, the plan names ${plan.length}`
    );
    process.exit(1);
  }
  const unmatched = [...picks];
  for (const entry of plan) {
    const at = unmatched.findIndex((sha) => same(sha, entry.sha));
    if (at === -1) {
      console.error(`rebase-helper: the plan names ${entry.sha}, which is not in the todo list`);
      process.exit(1);
    }
    unmatched.splice(at, 1);
  }

  // The plan is written out in full, so the order it gives is the order Git
  // applies. A dropped commit is simply left out, which is what `drop` means.
  const rewritten = plan
    .filter((p) => p.command !== 'drop')
    .map((p) => `${p.command} ${p.sha}`);

  if (rewritten.length === 0) {
    console.error('rebase-helper: the plan would leave no commits to apply');
    process.exit(1);
  }

  writeFileSync(target, rewritten.join('\n') + '\n');
  process.exit(0);
}

if (role === 'message') {
  // One message, written for every commit Git asks about. Squash uses this.
  const single = process.env.GITKEEN_SQUASH_MESSAGE_FILE;
  if (single) {
    writeFileSync(target, readFileSync(single, 'utf8'));
    process.exit(0);
  }

  /*
   * Several messages, one per reworded commit.
   *
   * Git runs this once per `reword`, always on COMMIT_EDITMSG, and tells us
   * nothing about which commit it is for. What it does do is fill the file
   * with that commit's current message first, so the message already there
   * is the only thing identifying it.
   *
   * GITKEEN_REWORDS holds a JSON array of { from, to }: the message to
   * expect, and the one to write in its place. A message that matches
   * nothing is left exactly as it was, because rewriting a commit the user
   * did not ask to reword would be worse than doing nothing.
   */
  const rewords = process.env.GITKEEN_REWORDS;
  if (rewords) {
    const plan = JSON.parse(rewords);
    const current = readFileSync(target, 'utf8');
    // Git's own comment lines are not part of the message.
    const body = current
      .split('\n')
      .filter((line) => !line.startsWith('#'))
      .join('\n')
      .trim();

    const match = plan.find((entry) => entry.from.trim() === body);
    if (match) writeFileSync(target, match.to.endsWith('\n') ? match.to : `${match.to}\n`);
    process.exit(0);
  }

  console.error('rebase-helper: no message source is set');
  process.exit(1);
}

console.error(`rebase-helper: unknown role "${role}"`);
process.exit(1);
