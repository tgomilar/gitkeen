/**
 * GitHub: pull requests and checks for a repository whose remote is on
 * github.com.
 *
 * The token comes from Gitalia's settings file or `GITHUB_TOKEN` (see
 * settings.mjs), and failing both, from the GitHub CLI if it is signed in.
 * It never leaves this process: the page learns only whether there is one.
 */
import { execFile } from 'node:child_process';
import { readKey, KEY_ENV } from './settings.mjs';
import { runGit } from './git.mjs';

const API = process.env.GITALIA_GITHUB_API || 'https://api.github.com';

/** The token, and where it came from. */
export async function githubToken() {
  const saved = await readKey('github');
  if (saved) return { token: saved, source: process.env[KEY_ENV.github] ? 'environment' : 'saved' };
  const fromCli = await new Promise((resolve) => {
    execFile('gh', ['auth', 'token'], { timeout: 3000 }, (err, stdout) => resolve(err ? '' : stdout.trim()));
  });
  return fromCli ? { token: fromCli, source: 'gh' } : { token: '', source: null };
}

/**
 * The GitHub repository a remote URL points at, or null for any other host.
 * Covers the three shapes Git accepts: `git@github.com:owner/repo.git`,
 * `ssh://git@github.com/owner/repo` and `https://github.com/owner/repo`.
 */
export function parseGithubRemote(url) {
  const m = /^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https?:\/\/(?:[^@/]+@)?github\.com\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(url.trim());
  return m ? { owner: m[1], name: m[2] } : null;
}

/**
 * Which GitHub repository this one works with: the remote the current
 * branch tracks, else `origin`, else the first remote on github.com.
 */
export async function githubRepo(path) {
  const { stdout: remotesOut } = await runGit(path, ['remote', '-v'], { allowFailure: true });
  const remotes = new Map();
  for (const line of remotesOut.split('\n')) {
    const [name, url, kind] = line.split(/\s+/);
    if (name && url && kind === '(fetch)') remotes.set(name, url);
  }
  const { stdout: tracked } = await runGit(path, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], { allowFailure: true });
  const upstreamRemote = tracked.trim().split('/')[0];
  const order = [upstreamRemote, 'origin', ...remotes.keys()].filter(Boolean);
  for (const name of order) {
    const url = remotes.get(name);
    const repo = url && parseGithubRemote(url);
    if (repo) return { ...repo, remote: name };
  }
  return null;
}

/** An error a person can act on, from a GitHub API answer. */
class GithubError extends Error {}

/** One call to the GitHub REST API. */
export async function github(token, method, route, body) {
  let res;
  try {
    res = await fetch(`${API}${route}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Gitalia',
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000)
    });
  } catch (err) {
    throw new GithubError(err?.name === 'TimeoutError' ? 'GitHub did not answer within 20 seconds.' : `Could not reach GitHub: ${err?.message ?? err}`);
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* reported below */ }
  if (res.ok) return json;

  const detail = json?.message ?? text.slice(0, 200);
  const extra = Array.isArray(json?.errors) ? json.errors.map((e) => e.message ?? e.code).filter(Boolean).join('; ') : '';
  if (res.status === 401) throw new GithubError('GitHub rejected the token. It may have expired or been revoked.');
  if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
    throw new GithubError('GitHub is limiting requests for now. Try again in a few minutes.');
  }
  if (res.status === 403 || res.status === 404) {
    throw new GithubError(
      `The token cannot ${method === 'GET' ? 'read' : 'change'} this on GitHub (${res.status}: ${detail}). ` +
        'A fine-grained token needs access to this repository, and the permission for what you asked.'
    );
  }
  throw new GithubError(`GitHub returned ${res.status}: ${detail}${extra ? ` (${extra})` : ''}`);
}

/** Pull requests, reduced to what the panel shows. */
export function shapePull(pr) {
  return {
    number: pr.number,
    title: pr.title,
    url: pr.html_url,
    state: pr.merged_at ? 'merged' : pr.state,
    draft: !!pr.draft,
    author: pr.user?.login ?? null,
    head: pr.head?.ref ?? null,
    headSha: pr.head?.sha ?? null,
    headRepo: pr.head?.repo?.full_name ?? null,
    base: pr.base?.ref ?? null,
    updated: pr.updated_at ? Date.parse(pr.updated_at) : null,
    comments: (pr.comments ?? 0) + (pr.review_comments ?? 0)
  };
}

/**
 * One commit's checks, as a single verdict and the list behind it.
 *
 * GitHub has two kinds: statuses (the older API, set by many CI services) and
 * check runs (GitHub Actions and apps). Both are read and joined. A token
 * that may read one and not the other still gets the half it can see.
 */
export async function commitChecks(token, owner, name, sha) {
  const [statuses, runs] = await Promise.all([
    github(token, 'GET', `/repos/${owner}/${name}/commits/${sha}/status`).catch(() => null),
    github(token, 'GET', `/repos/${owner}/${name}/commits/${sha}/check-runs?per_page=100`).catch(() => null)
  ]);
  const items = [];
  for (const s of statuses?.statuses ?? []) {
    items.push({ name: s.context, state: s.state === 'success' ? 'success' : s.state === 'pending' ? 'pending' : 'failure', url: s.target_url ?? null, detail: s.description ?? null });
  }
  for (const r of runs?.check_runs ?? []) {
    const state = r.status !== 'completed' ? 'pending'
      : ['success', 'neutral', 'skipped'].includes(r.conclusion) ? 'success' : 'failure';
    items.push({ name: r.name, state, url: r.html_url ?? null, detail: r.conclusion ?? r.status });
  }
  const state = items.length === 0 ? 'none'
    : items.some((i) => i.state === 'failure') ? 'failure'
    : items.some((i) => i.state === 'pending') ? 'pending' : 'success';
  return { sha, state, items, readable: statuses !== null || runs !== null };
}

export { GithubError };
