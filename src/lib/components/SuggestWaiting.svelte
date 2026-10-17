<script lang="ts">
  /**
   * What the commit panel shows while a suggestion is being written.
   *
   * A suggestion takes a few seconds, a local model often fifteen, and a bare
   * spinner makes that feel longer than it is. So the wait shows the job:
   * three outlines of commits fill with the user's own ticked files, one at a
   * time, while a line names the steps the backend goes through. The scene is
   * decorative, and nothing in it claims which file went where. It repeats
   * for as long as the wait lasts, and the real answer replaces it the
   * moment it arrives.
   *
   * With reduced motion asked for, everything holds still: the files are
   * shown in place and the line stops changing.
   */
  import 'motion-components/motion-icon-state';
  import 'motion-components/motion-typewriter';

  interface Props {
    files: string[];
    /** The model writing it, so the user knows who to thank or blame. */
    model: string | null;
    /** Where the rules come from, named in the last step. */
    rulesFrom: string | null;
  }

  let { files, model, rulesFrom }: Props = $props();

  const CARDS = 3;
  const PER_CARD = 3;
  /** Seconds between one file dropping into a card and the next. */
  const STEP = 0.55;

  // The first few files, dealt round the cards like a hand of cards, so each
  // outline fills from the top while the others do too.
  const dealt = $derived.by(() => {
    const shown = files.slice(0, CARDS * PER_CARD);
    const cards: { name: string; order: number }[][] = Array.from({ length: CARDS }, () => []);
    shown.forEach((path, i) => cards[i % CARDS].push({ name: path.split('/').pop() ?? path, order: i }));
    return cards;
  });
  const cycle = $derived(Math.max(1, Math.min(files.length, CARDS * PER_CARD)) * STEP + 2.4);

  const steps = $derived([
    `Reading ${files.length} files`,
    'Looking for separate tasks',
    'Giving each its own commit',
    'Writing a message for each',
    rulesFrom ? `Following ${rulesFrom}` : 'Checking every message'
  ]);

  let step = $state(0);
  let seconds = $state(0);
  $effect(() => {
    const started = Date.now();
    const clock = setInterval(() => (seconds = Math.floor((Date.now() - started) / 1000)), 1000);
    // The steps go round again for a long wait, as the cards do.
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const words = still ? null : setInterval(() => (step = (step + 1) % steps.length), 2800);
    return () => {
      clearInterval(clock);
      if (words) clearInterval(words);
    };
  });
</script>

<div class="waiting" role="status" aria-live="polite" aria-label={`Suggesting commits for ${files.length} files`}>
  <div class="head">
    <motion-icon-state class="spin" name="loading"></motion-icon-state>
    <span>
      {model ?? 'The AI'} is sorting {files.length} files into commits
      {#if seconds > 0}<span class="time">· {seconds} s</span>{/if}
    </span>
  </div>

  <div class="cards" style:--cycle="{cycle}s" aria-hidden="true">
    {#each dealt as card, c (c)}
      <div class="card">
        <div class="title">
          <span class="box"></span>
          <span class="bar" style:width="{[72, 58, 66][c]}%"></span>
        </div>
        {#each card as file (file.order)}
          <span class="file" style:animation-delay="{file.order * STEP}s">{file.name}</span>
        {/each}
      </div>
    {/each}
  </div>

  <p class="step">
    {#key step}
      <motion-typewriter interval="0.035" cursor>{steps[step]}</motion-typewriter>
    {/key}
  </p>
</div>

<style>
  .waiting {
    margin-top: 8px;
    padding: 9px 10px 8px;
    background: var(--bg-sunken);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: 11.5px;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 7px;
    color: var(--text-dim);
  }

  .spin {
    --mc-icon-size: 13px;
    --mc-icon-color: var(--accent);
    flex: none;
  }

  .time {
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }

  .cards {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px;
    margin: 9px 0 6px;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-height: 66px;
    padding: 6px 7px;
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }

  .title {
    display: flex;
    align-items: center;
    gap: 5px;
    margin-bottom: 3px;
  }

  .box {
    flex: none;
    width: 9px;
    height: 9px;
    border: 1.5px solid var(--border-strong);
    border-radius: 2.5px;
  }

  /* The message not written yet: a bar with light running across it. */
  .bar {
    height: 7px;
    border-radius: 4px;
    background: linear-gradient(
      90deg,
      var(--bg-hover) 0%,
      color-mix(in srgb, var(--accent) 35%, var(--bg-hover)) 50%,
      var(--bg-hover) 100%
    );
    background-size: 220% 100%;
    animation: shimmer 1.6s ease-in-out infinite;
  }

  .file {
    overflow: hidden;
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 10px;
    text-overflow: ellipsis;
    white-space: nowrap;
    opacity: 0;
    animation: drop var(--cycle) cubic-bezier(0.2, 0.9, 0.3, 1.25) infinite both;
  }

  .step {
    margin: 0;
    min-height: 1.5em;
    color: var(--text-faint);
  }

  @keyframes shimmer {
    from { background-position: 100% 0; }
    to { background-position: -120% 0; }
  }

  /*
   * Falls in with a little bounce and stays while the others arrive. Then
   * they leave in the order they came, and the round starts again.
   */
  @keyframes drop {
    0% { opacity: 0; transform: translateY(-9px) scale(0.92); }
    7% { opacity: 1; transform: translateY(0) scale(1); }
    88% { opacity: 1; transform: translateY(0); }
    100% { opacity: 0; transform: translateY(3px); }
  }

  @media (prefers-reduced-motion: reduce) {
    .bar { animation: none; }
    .file { animation: none; opacity: 1; }
  }
</style>
