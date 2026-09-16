import { mount } from 'svelte';
import './styles/theme.css';
import App from './App.svelte';
import { repoStore } from './lib/state/repo.svelte';

const target = document.getElementById('app');
if (!target) throw new Error('Missing #app element');

// Deep link: /?repo=/path/to/repo opens straight into a repository, and
// &theme=light|dark forces a theme. Handy for launchers and for screenshots.
// Read before mounting, because App reads the stored theme as it initialises.
const params = new URLSearchParams(location.search);
const theme = params.get('theme');
if (theme === 'light' || theme === 'dark') localStorage.setItem('gitalia.theme', theme);

const app = mount(App, { target });

const repo = params.get('repo');
if (repo) repoStore.open(repo);

export default app;
