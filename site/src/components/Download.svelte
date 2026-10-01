<script lang="ts">
  // Picks the download for the visitor's system. Gitkeen is a pre-release, and
  // GitHub leaves pre-releases out of "latest", so this links to the Releases
  // page and names the file to choose there (see docs/development.md).
  import { onMount } from 'svelte';

  const releases = 'https://github.com/tgomilar/gitkeen/releases';

  const systems = {
    mac: {
      name: 'macOS',
      files: [
        ['Apple silicon (M1 and newer)', 'Gitkeen-macOS-Apple-silicon.dmg'],
        ['Intel', 'Gitkeen-macOS-Intel.dmg'],
      ],
    },
    windows: { name: 'Windows', files: [['Windows 10 and 11', 'Gitkeen-Windows-Installer.exe']] },
    linux: {
      name: 'Linux',
      files: [
        ['Any Linux', 'Gitkeen-Linux.AppImage'],
        ['Debian and Ubuntu', 'Gitkeen-Linux.deb'],
      ],
    },
  } as const;

  type System = keyof typeof systems;

  let { installDocs }: { installDocs: string } = $props();
  let chosen = $state<System>('mac');

  onMount(() => {
    const platform =
      (navigator as Navigator & { userAgentData?: { platform: string } }).userAgentData?.platform ??
      navigator.userAgent;
    if (/win/i.test(platform)) chosen = 'windows';
    else if (/linux|x11|cros/i.test(platform) && !/android/i.test(platform)) chosen = 'linux';
  });
</script>

<div class="download">
  <div class="row">
    <a class="btn" href={releases}>Download for {systems[chosen].name}</a>
    <div class="systems" role="group" aria-label="Choose your system">
      {#each Object.entries(systems) as [key, system]}
        <button type="button" aria-pressed={chosen === key} onclick={() => (chosen = key as System)}>
          {system.name}
        </button>
      {/each}
    </div>
  </div>
  <p class="hint">
    On the Releases page, open the newest release and under Assets choose
    {#each systems[chosen].files as [label, file], i}
      {#if i > 0}{' or '}{/if}<code>{file}</code>{systems[chosen].files.length > 1 ? ` (${label})` : ''}
    {/each}.
    You also need Git 2.30 or newer. <a href={installDocs}>Installing Gitkeen</a>
  </p>
</div>

<style>
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 16px;
  }

  .systems {
    display: inline-flex;
    padding: 3px;
    border: 1px solid var(--border);
    border-radius: var(--r-pill);
    background: var(--surface);
  }

  button {
    font: 500 14px var(--sans);
    color: var(--muted);
    background: none;
    border: 0;
    padding: 6px 14px;
    border-radius: var(--r-pill);
    cursor: pointer;
  }

  button[aria-pressed='true'] {
    background: var(--ink);
    color: var(--bg);
  }

  .hint {
    margin: 16px 0 0;
    max-width: 52ch;
    color: var(--muted);
    font-size: 14px;
  }

  code {
    color: var(--text);
    white-space: nowrap;
  }
</style>
