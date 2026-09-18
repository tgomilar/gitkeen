/**
 * State behind the settings panel.
 *
 * Only the AI providers are configurable so far. The keys themselves live on
 * the backend and are never held here: this store knows which providers are
 * configured and where each key came from, which is all the panel needs to
 * describe the state truthfully.
 */
import { repoStore, describe } from './repo.svelte';
import { toasts } from './toasts.svelte';
import { commitStore } from './commit.svelte';
import type { KeyStatus, SuggestProviders } from '../git/types';

/** Everything the panel shows about one provider, ready to render. */
export interface ProviderRow {
  id: string;
  label: string;
  /** What the provider is, for someone deciding between them. */
  detail: string;
  /** True when this provider takes no key, so the field is hidden. */
  keyless: boolean;
  configured: boolean;
  source: 'environment' | 'saved' | null;
  variable: string;
  saved: boolean;
  /** True when this is the provider a suggestion would actually use. */
  preferred: boolean;
  model: string | null;
  /** Where to get a key, shown next to the field. */
  console: string | null;
}

const CATALOGUE = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    detail: 'Claude. Fast and inexpensive for one-line summaries.',
    keyless: false,
    console: 'https://console.anthropic.com/settings/keys'
  },
  {
    id: 'openai',
    label: 'OpenAI',
    detail: 'GPT. Needs API credits, which are separate from a ChatGPT plan.',
    keyless: false,
    console: 'https://platform.openai.com/api-keys'
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    detail: 'Runs on this machine, using whichever model you have loaded. Nothing is sent anywhere.',
    keyless: true,
    console: 'https://lmstudio.ai'
  },
  {
    id: 'ollama',
    label: 'Ollama',
    detail: 'Runs on this machine. No key, no account, and nothing is sent anywhere.',
    keyless: true,
    console: 'https://ollama.com/download'
  }
];

class SettingsStore {
  open = $state(false);
  busy = $state<string | null>(null);

  private status = $state<KeyStatus | null>(null);
  private providers = $state<SuggestProviders | null>(null);

  /** Where the keys are saved, shown so the user knows what to back up. */
  file = $derived(this.status?.file ?? null);

  rows = $derived.by<ProviderRow[]>(() => {
    const status = this.status;
    const providers = this.providers;
    return CATALOGUE.map((entry) => {
      const state = status?.providers[entry.id];
      // A local provider reports no key state, because it has none: it
      // counts as configured exactly when the backend could reach it.
      const configured = entry.keyless
        ? (providers?.available.includes(entry.id) ?? false)
        : (state?.configured ?? false);
      return {
        ...entry,
        configured,
        source: state?.source ?? null,
        variable: state?.variable ?? '',
        saved: state?.saved ?? false,
        preferred: providers?.preferred === entry.id,
        model: providers?.models[entry.id] ?? null
      };
    });
  });

  /** True when nothing is set up, so the panel can say so plainly. */
  none = $derived(this.rows.every((r) => !r.configured));

  async show() {
    this.open = true;
    await this.load();
  }

  hide() {
    this.open = false;
  }

  async load() {
    const repo = repoStore.repo;
    if (!repo) return;
    try {
      const [status, providers] = await Promise.all([repo.keyStatus(), repo.suggestProviders()]);
      this.status = status;
      this.providers = providers;
    } catch (err) {
      toasts.error('Could not read the settings', describe(err));
    }
  }

  /**
   * Save or clear one provider's key.
   *
   * An empty key removes it, which is how "Disconnect" works. The commit
   * panel is told afterwards, so its button appears or disappears without
   * the repository having to be reopened.
   */
  async setKey(provider: string, key: string): Promise<boolean> {
    const repo = repoStore.repo;
    if (!repo) return false;

    this.busy = provider;
    try {
      this.status = await repo.setKey(provider, key);
      this.providers = await repo.suggestProviders();
      await commitStore.loadSuggestProviders();
      const label = CATALOGUE.find((p) => p.id === provider)?.label ?? provider;
      toasts.success(key.trim() ? `Connected ${label}` : `Disconnected ${label}`);
      return true;
    } catch (err) {
      toasts.error('Could not save the key', describe(err));
      return false;
    } finally {
      this.busy = null;
    }
  }

  /**
   * Look again for a local server, which needs no key but must be running.
   * The provider is named so only that row shows as busy.
   */
  async recheck(provider: string) {
    this.busy = provider;
    try {
      await this.load();
      await commitStore.loadSuggestProviders();
    } finally {
      this.busy = null;
    }
  }
}

export const settingsStore = new SettingsStore();
