import { mount } from 'svelte';
// First, so every state module below finds its saved value under the new name.
import './lib/state/legacy-storage';
import './styles/theme.css';
import './styles/palettes.css';
// Applies the saved palette before the first paint, so it never flashes.
import { appearance } from './lib/state/appearance.svelte';
import App from './App.svelte';
import { routeLinksToBrowser } from './lib/desktop';
import { checkForUpdates } from './lib/updates';
import { repoStore } from './lib/state/repo.svelte';

const target = document.getElementById('app');
if (!target) throw new Error('Missing #app element');

// Deep link: /?repo=/path/to/repo opens straight into a repository, and
// &theme=light|dark forces a theme. Handy for launchers and for screenshots.
// Read before mounting, because App reads the stored theme as it initialises.
const params = new URLSearchParams(location.search);
const theme = params.get('theme');
if (theme === 'light' || theme === 'dark') localStorage.setItem('gitkeen.theme', theme);
// &palette=github (or one, solarized, dracula, vscode) picks a colour palette the same way.
const palette = params.get('palette');
if (palette) appearance.setPalette(palette);

routeLinksToBrowser();

const app = mount(App, { target });

const repo = params.get('repo');
if (repo) repoStore.open(repo);

// In the desktop app, look for a new version once the window has settled.
setTimeout(() => checkForUpdates({ quiet: true }), 4000);

export default app;
