/**
 * GitHub for the open repository: its pull requests, and the checks of the
 * commits on screen. All of it stays out of sight unless the repository has a
 * remote on github.com and there is a token to reach it with.
 */
import { repoStore, describe } from './repo.svelte';
import { toasts } from './toasts.svelte';
import { form } from './dialogs.svelte';
import type { CommitChecks, GithubStatus, PullRequest } from '../git/types';

/** How long a commit's checks are trusted before they are read again. */
const CHECKS_FRESH_MS = 60_000;

class GithubStore {
  status = $state<GithubStatus | null>(null);
  pulls = $state<PullRequest[]>([]);
  pullState = $state<'open' | 'closed' | 'all'>('open');
  loadingPulls = $state(false);
  pullsError = $state<string | null>(null);
  busy = $state(false);
  /** Checks by commit hash, with when they were read. */
  checks = $state<Record<string, CommitChecks & { at: number }>>({});
  private reading = new Set<string>();

  connected = $derived(!!this.status?.connected);
  /** The repository is on GitHub, whether or not Gitkeen can reach it yet. */
  onGithub = $derived(!!this.status?.repo);

  async loadStatus() {
    const repo = repoStore.repo;
    if (!repo) return;
    this.checks = {};
    try {
      const status = await repo.githubStatus();
      if (repo === repoStore.repo) this.status = status;
    } catch {
      this.status = null;
    }
  }

  async loadPulls(state = this.pullState) {
    const repo = repoStore.repo;
    if (!repo || !this.connected) return;
    this.pullState = state;
    this.loadingPulls = true;
    this.pullsError = null;
    try {
      const { pulls } = await repo.githubPulls(state);
      if (repo === repoStore.repo) this.pulls = pulls;
      this.loadChecks(pulls.map((p) => p.headSha).filter((s): s is string => !!s));
    } catch (err) {
      this.pullsError = describe(err);
    } finally {
      this.loadingPulls = false;
    }
  }

  /** Read the checks of these commits, unless they were read a moment ago. */
  async loadChecks(shas: string[]) {
    const repo = repoStore.repo;
    if (!repo || !this.connected) return;
    const now = Date.now();
    const stale = [...new Set(shas)].filter((sha) => !this.reading.has(sha) && !(this.checks[sha] && now - this.checks[sha].at < CHECKS_FRESH_MS));
    if (stale.length === 0) return;
    stale.forEach((sha) => this.reading.add(sha));
    try {
      for (let i = 0; i < stale.length; i += 20) {
        const { checks } = await repo.githubChecks(stale.slice(i, i + 20));
        const at = Date.now();
        const next = { ...this.checks };
        for (const [sha, c] of Object.entries(checks)) next[sha] = { ...c, at };
        if (repo === repoStore.repo) this.checks = next;
      }
    } catch {
      // Checks are a hint beside the history; failing to read them is not worth a message.
    } finally {
      stale.forEach((sha) => this.reading.delete(sha));
    }
  }

  checksFor(sha: string | null | undefined): CommitChecks | null {
    return sha ? this.checks[sha] ?? null : null;
  }

  /**
   * Open a pull request for the current branch. The title and description
   * start from its commits: one commit's subject, or the branch name with the
   * commits listed underneath.
   */
  async createForCurrentBranch() {
    const repo = repoStore.repo;
    const branch = repoStore.currentBranch;
    const base = this.status?.defaultBranch ?? 'main';
    if (!repo || !this.connected) return;
    if (!branch) {
      toasts.error('HEAD is detached', 'Check out the branch you want to open a pull request for.');
      return;
    }
    if (branch === base) {
      toasts.error(`${branch} is the default branch`, 'Open a pull request from another branch into it.');
      return;
    }
    let subjects: string[] = [];
    try {
      const compare = await repo.compare(`refs/heads/${base}`, `refs/heads/${branch}`);
      subjects = compare.onlyInTarget.commits.map((c) => c.subject).reverse();
    } catch {
      // No local copy of the base: the message simply starts from the branch name.
    }
    const title = subjects.length === 1 ? subjects[0] : branch.replace(/[-_/]+/g, ' ');
    const body = subjects.length > 1 ? subjects.map((s) => `- ${s}`).join('\n') : '';
    const answer = await form({
      title: `Open a pull request for ${branch}`,
      message: 'The first line is the title, and the rest is the description.',
      facts: [
        { label: 'From', value: branch },
        { label: 'Into', value: base },
        { label: 'Commits', value: String(subjects.length) }
      ],
      input: { label: 'Title and description', value: body ? `${title}\n\n${body}` : title, multiline: true },
      choices: [
        { value: 'ready', label: 'Ready for review', detail: 'Reviewers are asked for a review now.' },
        { value: 'draft', label: 'Draft', detail: 'Visible, but marked as not ready yet.' }
      ],
      confirmLabel: 'Open pull request'
    });
    if (!answer) return;
    const [first, ...rest] = answer.value.split('\n');
    this.busy = true;
    try {
      const { pull } = await repo.githubCreatePull({ branch, base, title: first.trim(), body: rest.join('\n').trim(), draft: answer.choice === 'draft' });
      toasts.success(`Opened pull request #${pull.number}`, pull.url);
      window.open(pull.url, '_blank', 'noopener');
      await this.loadPulls();
    } catch (err) {
      toasts.error('Could not open the pull request', describe(err));
    } finally {
      this.busy = false;
    }
  }
}

export const githubStore = new GithubStore();
