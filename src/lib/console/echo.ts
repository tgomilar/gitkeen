/**
 * "This button ran…": the Git command that matches what a button just did,
 * so the console teaches the command line while the buttons are used.
 *
 * The console listens; nothing is recorded while it has no listener. The
 * command is what a person would type for the same result. Gitalia may run
 * it with more options, or as several steps.
 */
type Args = Record<string, any>;

const quote = (s: string) => (/[\s"'$`\\]/.test(s) ? `"${s.replace(/(["\\$`])/g, '\\$1')}"` : s);
const short = (h: string) => (typeof h === 'string' ? h.slice(0, 7) : '');
const hashes = (a: Args) => [...(a.hashes ?? [])].reverse().map(short).join(' ');
const files = (paths: string[] | undefined) =>
  !paths?.length ? '' : paths.length > 3 ? `${paths.slice(0, 3).map(quote).join(' ')} …` : paths.map(quote).join(' ');

const COMMANDS: Record<string, (a: Args) => string | null> = {
  'branch.checkout': (a) => `switch ${quote(a.name)}`,
  'branch.create': (a) => (a.checkout === false ? `branch ${quote(a.name)}${a.from ? ` ${short(a.from)}` : ''}` : `switch -c ${quote(a.name)}${a.from ? ` ${short(a.from)}` : ''}`),
  'branch.delete': (a) => `branch ${a.force ? '-D' : '-d'} ${quote(a.name)}`,
  'branch.rename': (a) => `branch -m ${quote(a.from)} ${quote(a.to)}`,
  'branch.reset': (a) => `reset --${a.mode} ${short(a.target)}`,
  'commit.checkout': (a) => `switch --detach ${short(a.hash)}`,
  'repo.fetch': (a) => `fetch${a.remote ? ` ${a.remote}` : ''}`,
  'repo.pull': () => 'pull --no-rebase',
  'repo.merge': (a) => `merge ${quote(a.source)}`,
  'repo.push': (a) => ['push', a.force ? '--force-with-lease' : '', a.setUpstream ? '-u' : '', a.remote ?? (a.branch || a.setUpstream ? 'origin' : ''), a.branch ?? (a.setUpstream ? 'HEAD' : '')].filter(Boolean).join(' '),
  'tag.create': (a) => (a.message?.trim() ? `tag -a ${quote(a.name)} -m ${quote(a.message.trim())}` : `tag ${quote(a.name)}`) + (a.at ? ` ${short(a.at)}` : ''),
  'tag.delete': (a) => `tag -d ${quote(a.name)}`,
  'changes.stage': (a) => (a.on ? `add ${files(a.paths)}` : `restore --staged ${files(a.paths)}`),
  'changes.commit': (a) => `commit${a.amend ? ' --amend' : ''} -m ${quote(String(a.message ?? '').split('\n')[0])}`,
  'commits.cherryPick': (a) => `cherry-pick ${hashes(a)}`,
  'commits.revert': (a) => `revert ${hashes(a)}`,
  'commits.rebase': (a) => `rebase -i ${short(a.from)}^`,
  'stash.create': (a) => `stash push${a.includeUntracked ? ' -u' : ''}${a.message ? ` -m ${quote(a.message)}` : ''}${a.paths?.length ? ` -- ${files(a.paths)}` : ''}`,
  'stash.apply': (a) => `stash ${a.drop ? 'pop' : 'apply'} ${a.ref}`,
  'stash.drop': (a) => `stash drop ${a.ref}`
};

type Listener = (text: string, command: string) => void;
let listener: Listener | null = null;

/** The console registers here; one listener at a time. */
export function onEcho(fn: Listener | null) {
  listener = fn;
}

/** Called after a backend call succeeded. */
export function echo(method: string, args: Args | undefined) {
  if (!listener) return;
  const rule = COMMANDS[method];
  if (!rule) return;
  try {
    const command = rule(args ?? {});
    if (command) listener('This button ran the same as', command);
  } catch { /* an echo is a hint, never an error */ }
}
