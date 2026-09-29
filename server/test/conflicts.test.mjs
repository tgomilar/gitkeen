/**
 * The three-way merge editor's backend: reading a conflicted file apart into
 * sections, and writing a resolution back.
 *
 * The editor never stages a file itself. Writing only changes the working
 * tree; staging is `resolveConflicts`, which refuses a file that still holds
 * Git's markers. The tests pin that split down, because it is the only thing
 * standing between a half-chosen file and the repository's history.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, symlinkSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { methods } from '../api.mjs';
import { withRepo } from './harness.mjs';

/** File content from sections and a choice per conflict, as the editor builds it. */
function assemble(sections, choose = () => null) {
  return sections
    .map((section, i) => {
      if (section.type === 'text') return section.lines.join('');
      const pick = choose(i);
      return pick === 'ours' ? section.ours.join('') : pick === 'theirs' ? section.theirs.join('') : section.lines.join('');
    })
    .join('');
}

/**
 * A shared ancestor, then each branch rewrites the same file differently:
 * both sides write their own line where the other wrote theirs.
 */
async function divergentFile(repo, file = 'f.txt') {
  await repo.commit('base', { [file]: 'top\nmiddle\nbottom\n' });
  await repo.git(['checkout', '-q', '-b', 'topic']);
  await repo.commit('topic', { [file]: 'top\ntopic-middle\nbottom\n' });
  await repo.git(['checkout', '-q', 'main']);
  await repo.commit('main', { [file]: 'top\nmain-middle\nbottom\n' });
}

/** Run a merge and read the open conflict apart again. */
async function openConflict(repo, file) {
  const result = await methods['repo.merge']({ path: repo.path, source: 'topic' });
  assert.equal(result.conflicted, true, 'the merge must stop on a conflict');
  assert.equal(repo.midOperation(), true);
  return methods['conflicts.read']({ path: repo.path, file });
}

describe('reading a conflicted file', () => {
  test('cuts the file into text and conflict sections around the two sides', async () => {
    await withRepo(async (repo) => {
      await divergentFile(repo);
      const offer = await openConflict(repo, 'f.txt');
      assert.equal(offer.binary, false);

      const blocks = offer.sections.filter((s) => s.type === 'conflict');
      assert.equal(blocks.length, 1);
      const block = blocks[0];
      assert.deepEqual(block.ours, ['main-middle\n']);
      assert.deepEqual(block.theirs, ['topic-middle\n']);

      const text = offer.sections.filter((s) => s.type === 'text');
      assert.equal(text.map((s) => s.lines.join('')).join(''), 'top\nbottom\n');
      assert.equal(offer.lines, 7, 'top, a marker block holding three lines, bottom');
    });
  });

  test('reports the common ancestor from stage 1', async () => {
    await withRepo(async (repo) => {
      await divergentFile(repo);
      const offer = await openConflict(repo, 'f.txt');
      assert.equal(offer.stages.base.present, true);
      assert.equal(offer.stages.ours.present, true);
      assert.equal(offer.stages.theirs.present, true);
      assert.deepEqual(offer.base, ['top\n', 'middle\n', 'bottom\n']);
    });
  });

  test('an add/add conflict has no common ancestor to show', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'z.txt': 'z\n' });
      await repo.git(['checkout', '-q', '-b', 'topic']);
      await repo.commit('topic', { 'new.txt': 'topic new\n' });
      await repo.git(['checkout', '-q', 'main']);
      await repo.commit('main', { 'new.txt': 'main new\n' });

      const offer = await openConflict(repo, 'new.txt');
      assert.equal(offer.stages.base.present, false);
      assert.equal(offer.stages.ours.present, true);
      assert.equal(offer.stages.theirs.present, true);
      const block = offer.sections.find((s) => s.type === 'conflict');
      assert.deepEqual(block.ours, ['main new\n']);
      assert.deepEqual(block.theirs, ['topic new\n']);
    });
  });

  test('a modify/delete conflict leaves one side empty', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'gone.txt': 'one line of content\n' });
      await repo.git(['checkout', '-q', '-b', 'topic']);
      await repo.commit('topic edits it', { 'gone.txt': 'edited on topic\n' });
      await repo.git(['checkout', '-q', 'main']);
      await repo.git(['rm', '-q', 'gone.txt']);
      await repo.git(['commit', '-qm', 'main deleted it']);

      const result = await methods['repo.merge']({ path: repo.path, source: 'topic' });
      assert.equal(result.conflicted, true);
      const offer = await methods['conflicts.read']({ path: repo.path, file: 'gone.txt' });
      const block = offer.sections.find((s) => s.type === 'conflict');
      assert.ok(block, 'a conflict block exists');
      const empty = block.ours.length === 0 ? 'ours' : 'theirs';
      const kept = block[empty === 'ours' ? 'theirs' : 'ours'];
      assert.ok(kept.length > 0, 'exactly one side is empty, the other holds the content');
      assert.deepEqual(kept, ['edited on topic\n']);
    });
  });

  test('a binary conflict says so instead of trying to make sense of it', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'bin.dat': Buffer.from([0x00, 0x01, 0x02]) });
      await repo.git(['checkout', '-q', '-b', 'topic']);
      await repo.commit('topic', { 'bin.dat': Buffer.from([0x00, 0xff]) });
      await repo.git(['checkout', '-q', 'main']);
      await repo.commit('main', { 'bin.dat': Buffer.from([0x00, 0x01, 0xff]) });

      const offer = await openConflict(repo, 'bin.dat');
      assert.equal(offer.binary, true);
      assert.equal(offer.sections.length, 0);
    });
  });

  test('keeps the no-newline ending, so a resolution is byte-for-byte', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'snip.txt': 'top\nmiddle\nbottom' });
      await repo.git(['checkout', '-q', '-b', 'topic']);
      await repo.commit('topic', { 'snip.txt': 'top\ntopic\nbottom' });
      await repo.git(['checkout', '-q', 'main']);
      await repo.commit('main', { 'snip.txt': 'top\nmain\nbottom' });

      const offer = await openConflict(repo, 'snip.txt');
      const block = offer.sections.find((s) => s.type === 'conflict');
      assert.deepEqual(block.theirs, ['topic\n']);

      const content = assemble(offer.sections, () => 'theirs');
      await methods['conflicts.resolve']({ path: repo.path, file: 'snip.txt', content });
      const { stdout } = await repo.git(['show', ':snip.txt']);
      assert.equal(stdout, 'top\ntopic\nbottom', 'theirs wins and the final newline survives the merge');
    });
  });

  test('refuses a file that is not in conflict', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'f.txt': 'one\n' });
      await assert.rejects(
        () => methods['conflicts.read']({ path: repo.path, file: 'f.txt' }),
        /no conflict/
      );
    });
  });

  test('refuses a path that would leave the repository', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'f.txt': 'one\n' });
      await assert.rejects(
        () => methods['conflicts.read']({ path: repo.path, file: '../escape.txt' }),
        /Unsafe file path/
      );
    });
  });
});

describe('writing a resolution', () => {
  test('choosing ours replaces the block and leaves the rest byte-for-byte', async () => {
    await withRepo(async (repo) => {
      await divergentFile(repo);
      const offer = await openConflict(repo, 'f.txt');
      const content = assemble(offer.sections, () => 'ours');
      await methods['conflicts.resolve']({ path: repo.path, file: 'f.txt', content });

      assert.equal((await repo.git(['show', ':f.txt'])).stdout, 'top\nmain-middle\nbottom\n');
      assert.equal(readFileSync(join(repo.path, 'f.txt'), 'utf8'), 'top\nmain-middle\nbottom\n', 'the worktree matches');
      assert.equal(await repo.status(), '', 'resolving with ours restores the file and stages it silently');
    });
  });

  test('picking different sides per block makes a mixed file', async () => {
    await withRepo(async (repo) => {
      const sep = 'neutral\n'.repeat(7);
      const base = `a\n${sep}b\n${sep}c\n`;
      await repo.commit('base', { 'mix.txt': base });
      await repo.git(['checkout', '-q', '-b', 'topic']);
      await repo.commit('topic', { 'mix.txt': `a-topic\n${sep}b-topic\n${sep}c-topic\n` });
      await repo.git(['checkout', '-q', 'main']);
      await repo.commit('main', { 'mix.txt': `a-main\n${sep}b-main\n${sep}c-main\n` });

      const offer = await openConflict(repo, 'mix.txt');
      assert.equal(offer.sections.filter((s) => s.type === 'conflict').length, 3);

      const content = offer.sections
        .map((s, i) => {
          if (s.type === 'text') return s.lines.join('');
          return i === 2 ? s.ours.join('') : s.theirs.join(''); // only the middle block keeps ours
        })
        .join('');
      await methods['conflicts.resolve']({ path: repo.path, file: 'mix.txt', content });
      assert.equal((await repo.git(['show', ':mix.txt'])).stdout, `a-topic\n${sep}b-main\n${sep}c-topic\n`);
    });
  });

  test('a file that still holds markers is left un-staged and still open', async () => {
    await withRepo(async (repo) => {
      await divergentFile(repo);
      const offer = await openConflict(repo, 'f.txt');
      const content = assemble(offer.sections, () => null); // no choice: markers stay

      await assert.rejects(
        () => methods['conflicts.resolve']({ path: repo.path, file: 'f.txt', content }),
        /still contain conflict markers/
      );
      assert.match(await repo.status(), /^UU f\.txt$/m, 'the file is still conflicted');
      assert.equal(repo.midOperation(), true, 'the merge stays open, so it can be abandoned or continued elsewhere');
    });
  });

  test('marking resolved accepts a file fixed by hand in a terminal', async () => {
    await withRepo(async (repo) => {
      await divergentFile(repo);
      await openConflict(repo, 'f.txt');
      repo.write('f.txt', 'top\nmanually fixed\nbottom\n');
      const result = await methods['changes.markResolved']({ path: repo.path, paths: ['f.txt'] });
      assert.equal(result.ok, true);
      assert.equal(result.resolved, 1);
      assert.match(await repo.status(), /^M  f.txt$/);
    });
  });
});
describe('what the merge editor must not do', () => {
  test('refuses a conflicted symbolic link, so nothing outside the repository is read or written', async () => {
    await withRepo(async (repo) => {
      const outside = join(repo.path, '..', `outside-${Date.now()}.txt`);
      writeFileSync(outside, 'secret\n');
      try {
        await repo.commit('base', { 'keep.txt': 'k\n' });
        await repo.git(['checkout', '-q', '-b', 'topic']);
        symlinkSync(outside, join(repo.path, 'l'));
        await repo.commit('topic adds a link', {});
        await repo.git(['checkout', '-q', 'main']);
        symlinkSync('/etc/hosts', join(repo.path, 'l'));
        await repo.commit('main adds another', {});
        await methods['repo.merge']({ path: repo.path, source: 'topic' });
        assert.match(await repo.status(), /^AA l$/m);

        await assert.rejects(() => methods['conflicts.read']({ path: repo.path, file: 'l' }), /symbolic link/);
        await assert.rejects(
          () => methods['conflicts.resolve']({ path: repo.path, file: 'l', content: 'overwritten\n' }),
          /symbolic link/
        );
        assert.equal(readFileSync(outside, 'utf8'), 'secret\n', 'the file the link points at is untouched');
      } finally {
        rmSync(outside, { force: true });
      }
    });
  });

  test('a refused result leaves the working-tree file as Git wrote it', async () => {
    await withRepo(async (repo) => {
      await divergentFile(repo);
      const offer = await openConflict(repo, 'f.txt');
      const before = readFileSync(join(repo.path, 'f.txt'), 'utf8');
      await assert.rejects(
        () => methods['conflicts.resolve']({ path: repo.path, file: 'f.txt', content: 'half\n<<<<<<< HEAD\nx\n' }),
        /still contain conflict markers/
      );
      assert.equal(readFileSync(join(repo.path, 'f.txt'), 'utf8'), before);
      assert.ok(offer);
    });
  });

  test('a line of equals signs longer than a marker is content, not a divider', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'doc.md': 'Title\n=====\n\nbody\n' });
      await repo.git(['checkout', '-q', '-b', 'topic']);
      await repo.commit('topic', { 'doc.md': 'Topic title\n===========\n\nbody\n' });
      await repo.git(['checkout', '-q', 'main']);
      await repo.commit('main', { 'doc.md': 'Main title\n==========\n\nbody\n' });

      const offer = await openConflict(repo, 'doc.md');
      const block = offer.sections.find((s) => s.type === 'conflict');
      assert.deepEqual(block.ours, ['Main title\n', '==========\n']);
      assert.deepEqual(block.theirs, ['Topic title\n', '===========\n']);
    });
  });
});

describe('resolving a modify/delete conflict', () => {
  async function modifyDelete(repo) {
    await repo.commit('base', { 'gone.txt': 'a\nB\nc\n' });
    await repo.git(['checkout', '-q', '-b', 'topic']);
    await repo.commit('topic edits it', { 'gone.txt': 'a\nB\nc\nd\n' });
    await repo.git(['checkout', '-q', 'main']);
    await repo.git(['rm', '-q', 'gone.txt']);
    await repo.git(['commit', '-qm', 'main deleted it']);
    await methods['repo.merge']({ path: repo.path, source: 'topic' });
    return methods['conflicts.read']({ path: repo.path, file: 'gone.txt' });
  }

  test('the whole file is one choice, not the file plus the choice', async () => {
    await withRepo(async (repo) => {
      const offer = await modifyDelete(repo);
      assert.equal(offer.sections.length, 1);
      const [block] = offer.sections;
      assert.equal(block.type, 'conflict');
      assert.deepEqual(block.deleted, { ours: true, theirs: false });
      assert.equal(assemble(offer.sections, () => 'theirs'), 'a\nB\nc\nd\n');
    });
  });

  test('keeping the edited side keeps the file once', async () => {
    await withRepo(async (repo) => {
      const offer = await modifyDelete(repo);
      await methods['conflicts.resolve']({ path: repo.path, file: 'gone.txt', content: assemble(offer.sections, () => 'theirs') });
      assert.equal((await repo.git(['show', ':gone.txt'])).stdout, 'a\nB\nc\nd\n');
    });
  });

  test('keeping the deleting side deletes the file', async () => {
    await withRepo(async (repo) => {
      await modifyDelete(repo);
      const result = await methods['conflicts.resolve']({ path: repo.path, file: 'gone.txt', remove: true });
      assert.equal(result.ok, true);
      assert.equal(existsSync(join(repo.path, 'gone.txt')), false, 'gone from the working tree');
      assert.equal((await repo.files()).includes('gone.txt'), false, 'gone from the index');
      assert.doesNotMatch(await repo.status(), /gone\.txt/);
    });
  });

  test('deleting is refused when neither side deleted the file', async () => {
    await withRepo(async (repo) => {
      await divergentFile(repo);
      await openConflict(repo, 'f.txt');
      await assert.rejects(
        () => methods['conflicts.resolve']({ path: repo.path, file: 'f.txt', remove: true }),
        /Neither side deleted/
      );
      assert.match(await repo.status(), /^UU f\.txt$/m);
    });
  });
});
