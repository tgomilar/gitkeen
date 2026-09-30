/**
 * The entry point of the desktop app's backend executable.
 *
 * One executable plays two parts. Run plainly, it is the backend server
 * (standalone.mjs). Run with `--gitkeen-rebase-helper`, it is the editor Git
 * calls during an interactive rebase (rebase-helper.mjs), because inside the
 * packaged app there is no separate Node or script file to run for that.
 */
import { execFileSync } from 'node:child_process';
import { delimiter } from 'node:path';

const HELPER_FLAG = '--gitkeen-rebase-helper';

/**
 * An app opened from the Finder gets a bare PATH and none of the shell's
 * variables, so git-lfs, gh and a GITHUB_TOKEN set in ~/.zshrc would all be
 * missing. The login shell is asked once for PATH and for the few variables
 * Gitkeen reads; nothing else is taken over.
 */
const FROM_SHELL = [
  'PATH', 'GITHUB_TOKEN', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_MODEL', 'OPENAI_MODEL',
  'OLLAMA_HOST', 'OLLAMA_MODEL', 'LMSTUDIO_HOST', 'LMSTUDIO_MODEL', 'GITKEEN_CONFIG'
];

function adoptShellEnvironment() {
  // A Windows app gets the user's environment already, and has no login shell.
  if (process.platform === 'win32') return;
  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh');
  try {
    const script = FROM_SHELL.map((name) => `printf '%s\\0%s\\0' ${name} "$${name}"`).join('; ');
    const out = execFileSync(shell, ['-ilc', script], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
    const parts = out.split('\0');
    for (let i = 0; i + 1 < parts.length; i += 2) {
      const name = parts[i].replace(/^[\s\S]*?([A-Z_]+)$/, '$1');
      if (FROM_SHELL.includes(name) && parts[i + 1]) process.env[name] = parts[i + 1];
    }
  } catch {
    // No login shell to ask: fall back to the usual places tools live.
  }
  const extra = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];
  const path = (process.env.PATH || '').split(delimiter).filter(Boolean);
  process.env.PATH = [...path, ...extra.filter((d) => !path.includes(d))].join(delimiter);
}

const at = process.argv.indexOf(HELPER_FLAG);
if (at !== -1) {
  // The helper reads its role and file from argv[2] and argv[3].
  process.argv = [process.argv[0], 'rebase-helper', ...process.argv.slice(at + 1)];
  import('./rebase-helper.mjs');
} else {
  adoptShellEnvironment();
  process.env.GITKEEN_REBASE_EDITOR = `"${process.execPath}" ${HELPER_FLAG}`;
  import('./standalone.mjs');
}
