/**
 * State behind the settings panel.
 *
 * Only the AI providers are configurable so far. The keys themselves live on
 * the backend and are never held here: this store knows which providers are
 * configured and where each key came from, which is all the panel needs to
 * describe the state truthfully.
 */
import { repoStore, describe } from './repo.svelte';
import { githubStore } from './github.svelte';
import { toasts } from './toasts.svelte';
import { commitStore } from './commit.svelte';
import type { KeyStatus, LmstudioModel, LmstudioStatus, OllamaStatus, SuggestProviders } from '../git/types';

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
  /** Where to get a key, or the app itself for a local provider. */
  console: string | null;
  /** The words of that link, naming where it leads. */
  consoleLabel: string;
}

const CATALOGUE = [
  {
    id: 'lmstudio',
    label: 'LM Studio',
    detail: 'Runs on this machine, using whichever model you have loaded. Nothing is sent anywhere.',
    keyless: true,
    console: 'https://lmstudio.ai',
    consoleLabel: 'Download LM Studio'
  },
  {
    id: 'ollama',
    label: 'Ollama',
    detail: 'Runs on this machine. No key, no account, and nothing is sent anywhere.',
    keyless: true,
    console: 'https://ollama.com/download',
    consoleLabel: 'Download Ollama'
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    detail: 'Claude. Fast and inexpensive for one-line summaries.',
    keyless: false,
    console: 'https://console.anthropic.com/settings/keys',
    consoleLabel: 'Get an Anthropic API key'
  },
  {
    id: 'openai',
    label: 'OpenAI',
    detail: 'GPT. Needs API credits, which are separate from a ChatGPT plan.',
    keyless: false,
    console: 'https://platform.openai.com/api-keys',
    consoleLabel: 'Get an OpenAI API key'
  }
];

class SettingsStore {
  open = $state(false);
  busy = $state<string | null>(null);

  private status = $state<KeyStatus | null>(null);
  private providers = $state<SuggestProviders | null>(null);

  /** Installed, running, which models: what the Ollama row needs to offer the next step. */
  ollama = $state<OllamaStatus | null>(null);
  private polling: ReturnType<typeof setInterval> | null = null;

  /** The same for LM Studio, plus what it has downloaded, asked for only when nothing is loaded. */
  lmstudio = $state<LmstudioStatus | null>(null);
  lmstudioDownloaded = $state<LmstudioModel[] | null>(null);

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

  /** The GitHub token's state: saved here, from the environment, or neither. */
  github = $derived(this.status?.providers['github'] ?? null);

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
      const [status, providers, ollama, lmstudio] = await Promise.all([
        repo.keyStatus(),
        repo.suggestProviders(),
        repo.ollamaStatus(),
        repo.lmstudioStatus()
      ]);
      this.status = status;
      this.providers = providers;
      this.ollama = ollama;
      if (ollama.pull && !ollama.pull.done) this.watchPull();
      await this.setLmstudio(lmstudio);
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
      if (provider === 'github') await githubStore.loadStatus();
      const label = provider === 'github' ? 'GitHub' : CATALOGUE.find((p) => p.id === provider)?.label ?? provider;
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
   * Use this provider for suggestions and explanations from now on.
   * The commit panel is told too, so its next suggestion uses it.
   */
  async choose(provider: string) {
    const repo = repoStore.repo;
    if (!repo) return;
    this.busy = provider;
    try {
      this.providers = await repo.setProvider(provider);
      await commitStore.loadSuggestProviders();
      toasts.success(`Using ${CATALOGUE.find((p) => p.id === provider)?.label ?? provider}`);
    } catch (err) {
      toasts.error('Could not change the provider', describe(err));
    } finally {
      this.busy = null;
    }
  }

  /**
   * Use this model for a local provider. The commit panel is told, so its
   * tooltip and next suggestion name the new model.
   */
  async chooseModel(provider: string, model: string) {
    const repo = repoStore.repo;
    if (!repo) return;
    this.busy = provider;
    try {
      this.providers = await repo.setModel(provider, model);
      await commitStore.loadSuggestProviders();
    } catch (err) {
      toasts.error('Could not change the model', describe(err));
    } finally {
      this.busy = null;
    }
  }

  /** Start the Ollama the user installed. Takes a few seconds the first time. */
  async startOllama() {
    const repo = repoStore.repo;
    if (!repo) return;
    this.busy = 'ollama';
    try {
      this.ollama = await repo.startOllama();
      this.providers = await repo.suggestProviders();
      await commitStore.loadSuggestProviders();
      toasts.success('Ollama is running', this.ollama.models.length ? null : 'Download a model to start using it.');
    } catch (err) {
      toasts.error('Could not start Ollama', describe(err));
    } finally {
      this.busy = null;
    }
  }

  /** Download a model into Ollama. The download runs on the backend, so the panel can close meanwhile. */
  async pullModel(model: string) {
    const repo = repoStore.repo;
    if (!repo) return;
    try {
      this.ollama = await repo.pullModel(model);
      this.watchPull();
    } catch (err) {
      toasts.error('Could not start the download', describe(err));
    }
  }

  /**
   * Ask how far the download has got until it ends. A model is gigabytes,
   * so this keeps going after the panel closes and says when it is done.
   */
  private watchPull() {
    if (this.polling) return;
    this.polling = setInterval(async () => {
      const repo = repoStore.repo;
      if (!repo) return;
      try {
        this.ollama = await repo.ollamaStatus();
      } catch {
        return;
      }
      const pull = this.ollama.pull;
      if (pull && !pull.done) return;
      clearInterval(this.polling!);
      this.polling = null;
      if (!pull) return;
      if (pull.error) {
        toasts.error(`Could not download ${pull.model}`, pull.error);
        return;
      }
      this.providers = await repo.suggestProviders();
      await commitStore.loadSuggestProviders();
      toasts.success(`Downloaded ${pull.model}`, 'Ollama is ready to suggest commit messages.');
    }, 700);
  }

  /**
   * Keep LM Studio's state, and when its server runs with nothing loaded,
   * fetch what could be loaded. That needs its `lms` command, which wakes
   * LM Studio's background service, so it is asked only in that one case.
   */
  private async setLmstudio(next: LmstudioStatus) {
    this.lmstudio = next;
    if (!next.running || next.models.length || !next.cli) {
      this.lmstudioDownloaded = null;
      return;
    }
    try {
      this.lmstudioDownloaded = await repoStore.repo!.lmstudioDownloaded();
    } catch {
      this.lmstudioDownloaded = [];
    }
  }

  /** Start LM Studio's server. */
  async startLmstudio() {
    const repo = repoStore.repo;
    if (!repo) return;
    this.busy = 'lmstudio';
    try {
      await this.setLmstudio(await repo.startLmstudio());
      this.providers = await repo.suggestProviders();
      await commitStore.loadSuggestProviders();
      toasts.success('The LM Studio server is running');
    } catch (err) {
      toasts.error('Could not start LM Studio', describe(err));
    } finally {
      this.busy = null;
    }
  }

  /** Load a downloaded model into LM Studio, then use it. A large one takes a while. */
  async loadLmstudio(key: string) {
    const repo = repoStore.repo;
    if (!repo) return;
    // Named now: once a model is loaded, the downloaded list is no longer kept.
    const name = this.lmstudioDownloaded?.find((m) => m.key === key)?.name ?? key;
    this.busy = 'lmstudio';
    try {
      await this.setLmstudio(await repo.loadLmstudio(key));
      this.providers = await repo.setModel('lmstudio', key);
      await commitStore.loadSuggestProviders();
      toasts.success(`Loaded ${name}`);
    } catch (err) {
      toasts.error('Could not load the model', describe(err));
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
