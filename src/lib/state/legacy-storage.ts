/**
 * The app was called Gitalia before, and its saved layout, theme and recent
 * repositories are stored under `gitalia.` keys. Copy each one to its
 * `gitkeen.` name once, before any state module reads its key.
 */
try {
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith('gitalia.')) continue;
    const next = 'gitkeen.' + key.slice('gitalia.'.length);
    if (localStorage.getItem(next) === null) localStorage.setItem(next, localStorage.getItem(key)!);
    localStorage.removeItem(key);
  }
} catch {
  /* storage blocked: nothing saved to carry over */
}
