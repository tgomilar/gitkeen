/**
 * GitHub pull requests and checks, against a stand-in for GitHub's API, so
 * no test ever reaches github.com or needs a real token.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { withRepo } from './harness.mjs';

const calls = [];
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    calls.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null });
    res.setHeader('Content-Type', 'application/json');
    const send = (code, json) => { res.statusCode = code; res.end(JSON.stringify(json)); };
    if (req.url === '/user') return send(200, { login: 'ann' });
    if (req.url === '/repos/ann/app') return send(200, { default_branch: 'main', private: true });
    if (req.url.startsWith('/repos/ann/app/pulls?')) {
      return send(200, [{
        number: 7, title: 'Add login', html_url: 'https://github.com/ann/app/pull/7', state: 'open', draft: false,
        user: { login: 'bob' }, head: { ref: 'login', sha: 'a'.repeat(40), repo: { full_name: 'ann/app' } },
        base: { ref: 'main' }, updated_at: '2026-09-01T10:00:00Z', comments: 2, review_comments: 1, merged_at: null
      }]);
    }
    if (req.method === 'POST' && req.url === '/repos/ann/app/pulls') {
      const { title, head, base, draft } = JSON.parse(body);
      return send(201, { number: 8, title, html_url: 'https://github.com/ann/app/pull/8', state: 'open', draft, user: { login: 'ann' }, head: { ref: head, sha: 'b'.repeat(40) }, base: { ref: base } });
    }
    if (req.url.endsWith('/status')) return send(200, { statuses: [{ context: 'ci/lint', state: 'success', target_url: 'https://ci/1' }] });
    if (req.url.includes('/check-runs')) return send(200, { check_runs: [{ name: 'tests', status: 'completed', conclusion: 'failure', html_url: 'https://gh/run/2' }] });
    send(404, { message: 'Not Found' });
  });
});

let methods, parseGithubRemote;
before(async () => {
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  process.env.GITALIA_GITHUB_API = `http://127.0.0.1:${server.address().port}`;
  process.env.GITHUB_TOKEN = 'test-token';
  ({ methods } = await import('../api.mjs'));
  ({ parseGithubRemote } = await import('../github.mjs'));
});
after(() => server.close());

/** A repository whose origin is ann/app on GitHub, with `branch` tracking it. */
async function onGithub(repo, branch = 'main') {
  await repo.commits(1);
  await repo.git(['remote', 'add', 'origin', 'git@github.com:ann/app.git']);
  const head = await repo.head();
  await repo.git(['update-ref', `refs/remotes/origin/${branch}`, head]);
  await repo.git(['config', `branch.${branch}.remote`, 'origin']);
  await repo.git(['config', `branch.${branch}.merge`, `refs/heads/${branch}`]);
}

describe('github remotes', () => {
  test('every shape of github.com remote is read, and other hosts are not', () => {
    for (const url of ['git@github.com:ann/app.git', 'ssh://git@github.com/ann/app', 'https://github.com/ann/app.git', 'https://x-token@github.com/ann/app']) {
      assert.deepEqual(parseGithubRemote(url), { owner: 'ann', name: 'app' }, url);
    }
    assert.equal(parseGithubRemote('git@gitlab.com:ann/app.git'), null);
    assert.equal(parseGithubRemote('https://github.com.evil.example/ann/app'), null);
  });
});

describe('github', () => {
  test('the status names the repository, the account and the default branch', async () => {
    await withRepo(async (repo) => {
      await onGithub(repo);
      const status = await methods['github.status']({ path: repo.path });
      assert.deepEqual(status.repo, { owner: 'ann', name: 'app', remote: 'origin' });
      assert.equal(status.connected, true);
      assert.equal(status.login, 'ann');
      assert.equal(status.defaultBranch, 'main');
      assert.equal(calls.at(-1).auth, 'Bearer test-token');
    });
  });

  test('a repository with no github remote is not connected', async () => {
    await withRepo(async (repo) => {
      await repo.commits(1);
      const status = await methods['github.status']({ path: repo.path });
      assert.equal(status.repo, null);
      assert.equal(status.connected, false);
      await assert.rejects(() => methods['github.pulls']({ path: repo.path }), /no remote on github/);
    });
  });

  test('pull requests come back in the shape the panel draws', async () => {
    await withRepo(async (repo) => {
      await onGithub(repo);
      const { pulls } = await methods['github.pulls']({ path: repo.path });
      assert.deepEqual(pulls[0], {
        number: 7, title: 'Add login', url: 'https://github.com/ann/app/pull/7', state: 'open', draft: false,
        author: 'bob', head: 'login', headSha: 'a'.repeat(40), headRepo: 'ann/app', base: 'main',
        updated: Date.parse('2026-09-01T10:00:00Z'), comments: 3
      });
    });
  });

  test('a pull request is opened from a pushed branch', async () => {
    await withRepo(async (repo) => {
      await onGithub(repo, 'main');
      await repo.git(['checkout', '-q', '-b', 'feature']);
      await repo.commit('feature work', { 'x.txt': 'x\n' });
      await assert.rejects(
        () => methods['github.createPull']({ path: repo.path, branch: 'feature', base: 'main', title: 'Feature' }),
        /not on origin yet/
      );
      await repo.git(['update-ref', 'refs/remotes/origin/feature', 'HEAD~1']);
      await repo.git(['config', 'branch.feature.remote', 'origin']);
      await repo.git(['config', 'branch.feature.merge', 'refs/heads/feature']);
      await assert.rejects(
        () => methods['github.createPull']({ path: repo.path, branch: 'feature', base: 'main', title: 'Feature' }),
        /1 commits not pushed/
      );
      await repo.git(['update-ref', 'refs/remotes/origin/feature', 'HEAD']);
      const result = await methods['github.createPull']({ path: repo.path, branch: 'feature', base: 'main', title: 'Feature', body: 'Why.', draft: true });
      assert.equal(result.pull.number, 8);
      assert.deepEqual(calls.at(-1).body, { title: 'Feature', body: 'Why.', head: 'feature', base: 'main', draft: true });
    });
  });

  test('statuses and check runs join into one verdict, a failure winning', async () => {
    await withRepo(async (repo) => {
      await onGithub(repo);
      const sha = await repo.head();
      const { checks } = await methods['github.checks']({ path: repo.path, shas: [sha] });
      assert.equal(checks[sha].state, 'failure');
      assert.deepEqual(checks[sha].items.map((i) => [i.name, i.state]), [['ci/lint', 'success'], ['tests', 'failure']]);
    });
  });

  test('refuses what is not a commit hash, or a branch that looks like an option', async () => {
    await withRepo(async (repo) => {
      await onGithub(repo);
      await assert.rejects(() => methods['github.checks']({ path: repo.path, shas: ['main'] }), /by commit hash/);
      await assert.rejects(() => methods['github.createPull']({ path: repo.path, branch: '--x', base: 'main', title: 't' }), /not a commit/);
    });
  });
});
