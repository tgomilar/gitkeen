<script lang="ts">
  /**
   * One console result, drawn: status as grouped files, log as a small graph,
   * branches with how far they are ahead and behind, stashes as a list, and a
   * patch in colour. Anything else is Git's own text. "Raw" shows Git's text
   * for any of them.
   */
  import type { ConsoleResult, Commit, StatusFile, Branch, Stash } from '../git/types';
  import { layoutGraph, laneColor } from '../graph/layout';
  import { highlightLine, languageFor } from '../syntax';
  import { relativeTime } from '../format';
  import { diffStore } from '../state/diff.svelte';
  import { repoStore } from '../state/repo.svelte';

  /** `raw` shows Git's own text instead of the picture; the panel holds the switch. */
  let { result, raw = false }: { result: ConsoleResult; raw?: boolean } = $props();

  const text = $derived(`${result.stdout ?? ''}${result.stderr ? (result.stdout ? '\n' : '') + result.stderr : ''}`.replace(/\s+$/, ''));
  const drawn = $derived(result.ok && result.kind && result.kind !== 'text');

  // Status, in the groups people act on.
  const groups = $derived.by(() => {
    if (result.kind !== 'status') return [];
    const files: StatusFile[] = result.data?.files ?? [];
    const letter = (c: string) => ({ M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', T: 'type changed', U: 'conflict' }[c] ?? c);
    return [
      { title: 'Conflicts', tone: 'conflict', side: 'unstaged' as const, files: files.filter((f) => f.state === 'conflicted').map((f) => ({ f, what: 'conflict' })) },
      { title: 'Staged', tone: 'staged', side: 'staged' as const, files: files.filter((f) => f.state !== 'conflicted' && f.state !== 'untracked' && f.index !== '.').map((f) => ({ f, what: letter(f.index) })) },
      { title: 'Not staged', tone: 'unstaged', side: 'unstaged' as const, files: files.filter((f) => f.state !== 'conflicted' && f.state !== 'untracked' && f.worktree !== '.').map((f) => ({ f, what: letter(f.worktree) })) },
      { title: 'Untracked', tone: 'untracked', side: 'unstaged' as const, files: files.filter((f) => f.state === 'untracked').map((f) => ({ f, what: 'new' })) }
    ].filter((g) => g.files.length);
  });

  // Log, as a small graph.
  const H = 22, LANE = 12, PAD = 6;
  const laneX = (lane: number) => PAD + lane * LANE + LANE / 2;
  const link = (a: number, y1: number, b: number, y2: number) => {
    const x1 = laneX(a), x2 = laneX(b);
    if (x1 === x2) return `M ${x1} ${y1} L ${x2} ${y2}`;
    const mid = (y1 + y2) / 2;
    return `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`;
  };
  const graph = $derived(result.kind === 'log' ? layoutGraph(result.data?.commits ?? []) : null);
  const graphWidth = $derived(graph ? PAD * 2 + Math.max(1, graph.laneCount) * LANE : 0);

  // A patch, line by line, each file's lines in its language's colours.
  const patch = $derived.by(() => {
    if (result.kind !== 'patch') return [];
    let lang: string | null = null;
    return (result.stdout ?? '').replace(/\n$/, '').split('\n').map((line) => {
      if (line.startsWith('diff --git ')) {
        const file = /^diff --git a\/.+ b\/(.+)$/.exec(line)?.[1] ?? '';
        lang = languageFor(file);
        return { tone: 'file', text: file, pieces: null };
      }
      if (/^(index |--- |\+\+\+ |new file|deleted file|similarity|rename |old mode|new mode|Binary)/.test(line)) return { tone: 'meta', text: line, pieces: null };
      if (line.startsWith('@@')) return { tone: 'hunk', text: line, pieces: null };
      if (line.startsWith('+')) return { tone: 'add', text: '+', pieces: highlightLine(line.slice(1), lang) };
      if (line.startsWith('-')) return { tone: 'del', text: '-', pieces: highlightLine(line.slice(1), lang) };
      if (line.startsWith(' ')) return { tone: 'ctx', text: ' ', pieces: highlightLine(line.slice(1), lang) };
      return { tone: 'meta', text: line, pieces: null };
    });
  });

  function openFile(file: StatusFile, side: 'staged' | 'unstaged') {
    diffStore.show({ file: file.path, origPath: file.origPath ?? null, source: 'Working tree', side, stageable: file.state !== 'conflicted' });
  }

  function openCommit(c: Commit) {
    if (repoStore.layout.index.has(c.hash)) repoStore.select(c.hash, 'replace');
  }

  const refClass = (kind: string) => (kind === 'tag' ? 'tag' : kind === 'remote' ? 'remote' : 'local');
</script>

<div class="output">
  {#if !drawn || raw}
    {#if text}<pre class="text" class:failed={!result.ok}>{text}</pre>{:else if result.ok}<p class="quiet">Done{result.ms != null ? ` in ${result.ms} ms` : ''}. Git printed nothing.</p>{/if}
  {:else if result.kind === 'status'}
    {#if groups.length === 0}
      <p class="clean">✓ Nothing to commit. Your files match the last commit.</p>
    {/if}
    {#each groups as g (g.title)}
      <div class="group {g.tone}">
        <p class="group-title">{g.title} <span class="count">{g.files.length}</span></p>
        {#each g.files as { f, what } (f.path)}
          <button class="file" onclick={() => openFile(f, g.side)} title="Open the diff">
            <span class="what">{what}</span>
            <span class="path mono">{#if f.origPath}{f.origPath} → {/if}{f.path}</span>
          </button>
        {/each}
      </div>
    {/each}
  {:else if result.kind === 'log' && graph}
    <div class="log">
      {#each graph.rows as row (row.commit.hash)}
        <button class="commit" onclick={() => openCommit(row.commit)} title="Show this commit in the graph">
          <svg width={graphWidth} height={H} aria-hidden="true">
            {#each row.passes as l}<path d={link(l.lane, 0, l.lane, H)} stroke={laneColor(l.colorLane)} />{/each}
            {#each row.incoming as l}<path d={link(l.lane, 0, row.lane, H / 2)} stroke={laneColor(l.colorLane)} />{/each}
            {#each row.outgoing as l}<path d={link(row.lane, H / 2, l.lane, H)} stroke={laneColor(l.colorLane)} />{/each}
            <circle cx={laneX(row.lane)} cy={H / 2} r={row.commit.parents.length > 1 ? 3 : 4}
              fill={row.commit.parents.length > 1 ? 'var(--bg-panel)' : laneColor(row.lane)} stroke={laneColor(row.lane)} stroke-width="2" />
          </svg>
          <span class="hash mono">{row.commit.shortHash}</span>
          {#each row.commit.refs as ref (ref.name)}
            <span class="ref {refClass(ref.kind)}" class:head={ref.isHead}>{ref.name}</span>
          {/each}
          <span class="subject">{row.commit.subject}</span>
          <span class="meta">{row.commit.author} · {relativeTime(row.commit.authorDate)}</span>
        </button>
      {/each}
      {#if result.data?.limited && graph.rows.length >= 50}<p class="quiet">The latest 50 commits. Add <code>-n 200</code> for more.</p>{/if}
    </div>
  {:else if result.kind === 'branches'}
    <div class="branches">
      {#each (result.data?.local ?? []) as b (b.name)}
        {@const br = b as Branch}
        <div class="branch" class:current={br.isHead}>
          <span class="marker">{br.isHead ? '●' : ''}</span>
          <span class="name mono">{br.name}</span>
          {#if br.upstream}
            <span class="upstream mono">{br.upstream}</span>
            {#if br.ahead || br.behind}
              {#if br.ahead}<span class="ahead" title="{br.ahead} commits to push">↑{br.ahead}</span>{/if}
              {#if br.behind}<span class="behind" title="{br.behind} commits to pull">↓{br.behind}</span>{/if}
            {:else}<span class="even">up to date</span>{/if}
          {:else}<span class="even">no upstream</span>{/if}
          <span class="meta">{br.date ? relativeTime(br.date) : ''}</span>
        </div>
      {/each}
      {#if (result.data?.remote ?? []).length && text.includes('remotes/')}
        {#each result.data.remote as b (b.name)}
          <div class="branch remote"><span class="marker"></span><span class="name mono">{b.name}</span><span class="meta">{b.date ? relativeTime(b.date) : ''}</span></div>
        {/each}
      {/if}
    </div>
  {:else if result.kind === 'stashes'}
    {#if (result.data ?? []).length === 0}<p class="quiet">No stashes.</p>{/if}
    {#each (result.data ?? []) as s (s.ref)}
      {@const st = s as Stash}
      <div class="stash">
        <span class="ref-name mono">{st.ref}</span>
        <span class="subject">{st.message}</span>
        <span class="meta">{st.branch ? `on ${st.branch} · ` : ''}{relativeTime(st.date)}</span>
      </div>
    {/each}
  {:else if result.kind === 'patch'}
    <div class="patch mono">
      {#each patch as line, i (i)}
        {#if line.tone === 'file'}
          <div class="p-file">{line.text}</div>
        {:else if line.pieces}
          <div class="p-line {line.tone}"><span class="sign">{line.text}</span>{#each line.pieces as piece, j (j)}<span class={piece.cls ? `syn-${piece.cls}` : ''}>{piece.text}</span>{/each}</div>
        {:else}
          <div class="p-line {line.tone}">{line.text}</div>
        {/if}
      {/each}
    </div>
  {/if}
</div>

<style>
  .output { margin: 4px 0 0; }
  .mono, code { font-family: var(--font-mono); font-size: 12px; }
  .text { margin: 0; padding: 2px 0; font-family: var(--font-mono); font-size: 12px; white-space: pre-wrap; word-break: break-word; color: var(--text); }
  .text.failed { color: var(--danger); }
  .quiet { margin: 2px 0; color: var(--text-faint); }
  .clean { margin: 2px 0; color: var(--success); }

  .group { margin: 2px 0 6px; }
  .group-title { margin: 0 0 2px; font-weight: 600; font-size: 11.5px; }
  .count { color: var(--text-faint); font-weight: 400; }
  .group.staged .group-title { color: var(--change-added); }
  .group.unstaged .group-title { color: var(--change-modified); }
  .group.untracked .group-title { color: var(--change-unversioned); }
  .group.conflict .group-title { color: var(--change-conflict); }
  .file, .commit {
    display: flex; align-items: center; gap: 8px; width: 100%; padding: 0 6px;
    background: none; border: 0; border-radius: var(--radius-sm); color: var(--text); text-align: left;
  }
  .file { padding: 1px 6px 1px 14px; }
  .file:hover, .commit:hover { background: var(--bg-hover); }
  .what { width: 84px; flex: none; color: var(--text-dim); font-size: 11.5px; }

  .commit { height: 22px; padding-left: 0; }
  .commit svg { flex: none; }
  .commit path { fill: none; stroke-width: 2; }
  .hash { color: var(--text-faint); flex: none; }
  .subject { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta { margin-left: auto; padding-left: 12px; flex: none; color: var(--text-faint); font-size: 11.5px; }
  .ref { flex: none; padding: 0 6px; border-radius: var(--radius-sm); font-size: 11px; line-height: 16px; }
  .ref.local { background: var(--ref-local-bg); color: var(--ref-local-text); }
  .ref.remote { background: var(--ref-remote-bg); color: var(--ref-remote-text); }
  .ref.tag { background: var(--ref-tag-bg); color: var(--ref-tag-text); }
  .ref.head { background: var(--ref-head-bg); color: var(--ref-head-text); }

  .branch, .stash { display: flex; align-items: center; gap: 10px; padding: 1px 6px; }
  .branch.current .name { color: var(--accent); font-weight: 600; }
  .marker { width: 10px; color: var(--accent); }
  .upstream { color: var(--text-faint); }
  .ahead { color: var(--success); font-weight: 600; }
  .behind { color: var(--warning); font-weight: 600; }
  .even { color: var(--text-faint); font-size: 11.5px; }
  .ref-name { color: var(--accent); flex: none; }

  .patch { font-size: 12px; line-height: 18px; }
  .p-file { margin: 6px 0 2px; padding: 2px 8px; background: var(--bg-sunken); border-radius: var(--radius-sm); font-weight: 600; }
  .p-line { white-space: pre-wrap; word-break: break-word; padding: 0 8px; }
  .p-line.meta { color: var(--text-faint); }
  .p-line.hunk { color: var(--accent); }
  .p-line.add { background: var(--diff-add-line); }
  .p-line.del { background: var(--diff-del-line); }
  .sign { display: inline-block; width: 14px; color: var(--text-faint); user-select: none; }
</style>
