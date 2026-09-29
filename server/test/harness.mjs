/**
 * Throwaway repositories for the tests to work on.
 *
 * Every test gets its own repository in a temporary directory and deletes it
 * afterwards, so tests cannot affect each other and a failing one leaves
 * nothing behind. Nothing here touches the user's own repositories.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runGit } from '../git.mjs';

/** Fixed identity and dates, so a commit's hash does not change per run. */
const ENV = {
  GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com'
};

export class Repo {
  constructor(path) {
    this.path = path;
  }

  /** An empty repository on `main`, with a committer already configured. */
  static async create() {
    const path = await mkdtemp(join(tmpdir(), 'gitalia-test-'));
    const repo = new Repo(path);
    await repo.git(['init', '-q', '-b', 'main']);
    await repo.git(['config', 'user.name', 'Test']);
    await repo.git(['config', 'user.email', 'test@example.com']);
    return repo;
  }

  /** A bare repository this one can push to, wired up as `origin`. */
  async withRemote() {
    const remote = await mkdtemp(join(tmpdir(), 'gitalia-remote-'));
    await runGit(remote, ['init', '-q', '--bare'], { allowFailure: true });
    await this.git(['remote', 'add', 'origin', remote]);
    this.remote = remote;
    return remote;
  }

  git(args, options = {}) {
    return runGit(this.path, args, { env: ENV, allowFailure: true, ...options });
  }

  /**
   * Write a file and commit it, returning the new commit's full hash.
   * `extra.env` reaches the commit, e.g. to pin the dates.
   */
  async commit(message, files = {}, extra = {}) {
    // A commit with no files named still needs something to record.
    const entries = Object.keys(files).length > 0
      ? files
      : { [`${message.replace(/\W+/g, '-')}.txt`]: message };
    for (const [name, content] of Object.entries(entries)) {
      writeFileSync(join(this.path, name), content);
    }
    await this.git(['add', '-A']);
    await this.git(['commit', '-qm', message], extra.env ? { env: extra.env } : {});
    return this.head();
  }

  /** `n` commits named "c1", "c2"… each touching a file of its own. */
  async commits(n, prefix = 'c') {
    const made = [];
    for (let i = 1; i <= n; i++) {
      made.push(await this.commit(`${prefix}${i}`, { [`${prefix}${i}.txt`]: `${i}\n` }));
    }
    return made;
  }

  async head() {
    const { stdout } = await this.git(['rev-parse', 'HEAD']);
    return stdout.trim();
  }

  /** Commit subjects, newest first. */
  async log() {
    const { stdout } = await this.git(['log', '--format=%s']);
    return stdout.trim().split('\n').filter(Boolean);
  }

  /** Full hashes, newest first, following the branch only. */
  async hashes() {
    const { stdout } = await this.git(['log', '--format=%H', '--first-parent']);
    return stdout.trim().split('\n').filter(Boolean);
  }

  async files() {
    const { stdout } = await this.git(['ls-files']);
    return stdout.trim().split('\n').filter(Boolean);
  }

  async status() {
    const { stdout } = await this.git(['status', '--short']);
    return stdout.trim();
  }

  /** True when Git is stopped part way through something. */
  midOperation() {
    return existsSync(join(this.path, '.git', 'rebase-merge'))
      || existsSync(join(this.path, '.git', 'rebase-apply'))
      || existsSync(join(this.path, '.git', 'MERGE_HEAD'));
  }

  write(name, content) {
    writeFileSync(join(this.path, name), content);
  }

  async destroy() {
    await rm(this.path, { recursive: true, force: true });
    if (this.remote) await rm(this.remote, { recursive: true, force: true });
  }
}

/** Run `body` against a fresh repository, cleaning up however it ends. */
export async function withRepo(body) {
  const repo = await Repo.create();
  try {
    return await body(repo);
  } finally {
    await repo.destroy();
  }
}
