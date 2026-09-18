/**
 * Commit message rules for whatever repository is open.
 *
 * Gitalia opens other people's repositories, so the rules cannot be baked in.
 * They are read from the repository itself, in the order a developer would
 * expect them to win:
 *
 *   1. a commitlint config, which states its rules in a form we can explain;
 *   2. a commit-msg hook, which enforces rules we can run but cannot read;
 *   3. nothing, in which case Conventional Commits is offered as a hint and
 *      nothing is ever blocked.
 *
 * Only the subset of commitlint rules that a person actually meets in practice
 * is implemented. An unknown rule is ignored rather than guessed at: enforcing
 * a rule we have misunderstood would block a commit the repository allows,
 * which is worse than missing one.
 */
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { constants } from 'node:fs';

/** Types from @commitlint/config-conventional, the near-universal default. */
const CONVENTIONAL_TYPES = [
  'build', 'chore', 'ci', 'docs', 'feat', 'fix',
  'perf', 'refactor', 'revert', 'style', 'test'
];

/**
 * The rules @commitlint/config-conventional brings with it.
 *
 * A config that only extends the preset still enforces all of these, so they
 * are filled in whenever the preset is extended. A rule the config states
 * itself always wins, which is how commitlint resolves the same overlap.
 *
 * Only the preset's blocking rules are listed. Its case and length rules for
 * the body and footer are omitted deliberately: they rarely decide whether a
 * commit is accepted, and a rule we enforce but cannot explain well is a
 * disabled button with no good reason attached.
 */
const CONVENTIONAL_PRESET = {
  'type-enum': { level: 2, applicable: 'always', value: CONVENTIONAL_TYPES },
  'type-empty': { level: 2, applicable: 'never', value: null },
  'type-case': { level: 2, applicable: 'always', value: 'lower-case' },
  'subject-empty': { level: 2, applicable: 'never', value: null },
  'subject-full-stop': { level: 2, applicable: 'never', value: '.' },
  'header-max-length': { level: 2, applicable: 'always', value: 100 },
  'body-leading-blank': { level: 1, applicable: 'always', value: null },
  'footer-leading-blank': { level: 1, applicable: 'always', value: null }
};

const CONFIG_FILES = [
  'commitlint.config.js', 'commitlint.config.cjs', 'commitlint.config.mjs',
  'commitlint.config.ts', '.commitlintrc', '.commitlintrc.json',
  '.commitlintrc.yml', '.commitlintrc.yaml', '.commitlintrc.js', '.commitlintrc.cjs'
];

const HOOK_FILES = ['.husky/commit-msg', '.git/hooks/commit-msg'];

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Pull `rules` out of a config file without executing it.
 *
 * A JS config is a module that could run anything, and opening a repository
 * must never run its code. So the file is read as text and the rules are
 * matched out of it. A rule we cannot parse is left out, which downgrades
 * enforcement to a hint rather than inventing a constraint.
 */
function parseRules(source, filename) {
  const rules = {};

  if (filename.endsWith('.json') || filename === '.commitlintrc') {
    try {
      const json = JSON.parse(source);
      return { rules: json.rules ?? {}, extends: [].concat(json.extends ?? []) };
    } catch {
      return { rules: {}, extends: [] };
    }
  }

  // `extends: ['@commitlint/config-conventional']` in any of its spellings.
  const extended = [];
  const extendsMatch = source.match(/extends\s*:\s*\[([^\]]*)\]/s);
  if (extendsMatch) {
    for (const m of extendsMatch[1].matchAll(/['"`]([^'"`]+)['"`]/g)) extended.push(m[1]);
  }

  // Each rule reads `'name': [level, applicable, value]`.
  const rulesBlock = source.match(/rules\s*:\s*\{(.*)\}/s);
  if (rulesBlock) {
    const body = rulesBlock[1];
    const entry = /['"`]?([a-z-]+(?:-[a-z]+)*)['"`]?\s*:\s*\[\s*(\d)\s*,\s*['"`](always|never)['"`]\s*(?:,\s*([^\]]+))?\]/g;
    for (const m of body.matchAll(entry)) {
      const [, name, level, applicable, rawValue] = m;
      let value = null;
      if (rawValue !== undefined) {
        const trimmed = rawValue.trim();
        if (trimmed.startsWith('[')) {
          value = [...trimmed.matchAll(/['"`]([^'"`]+)['"`]/g)].map((v) => v[1]);
        } else if (/^\d+$/.test(trimmed)) {
          value = Number(trimmed);
        } else {
          const quoted = trimmed.match(/^['"`]([^'"`]*)['"`]$/);
          if (quoted) value = quoted[1];
        }
      }
      rules[name] = { level: Number(level), applicable, value };
    }
  }

  return { rules, extends: extended };
}

/**
 * What the repository expects of a commit message.
 *
 * Returns a plain description the UI can show and the validator can apply, so
 * the rules the user is held to are always the rules they were shown.
 */
export async function readCommitRules(path) {
  for (const name of CONFIG_FILES) {
    const file = join(path, name);
    if (!(await exists(file))) continue;

    let source = '';
    try {
      source = await readFile(file, 'utf8');
    } catch {
      continue;
    }

    const parsed = parseRules(source, name);
    const conventional = parsed.extends.some((e) => e.includes('conventional'));

    // The config's own rules sit on top of whatever the preset supplies, so a
    // config that only extends still enforces the preset in full.
    const rules = conventional
      ? { ...CONVENTIONAL_PRESET, ...parsed.rules }
      : { ...parsed.rules };

    return {
      source: 'commitlint',
      file: name,
      enforced: true,
      rules,
      types: rules['type-enum']?.value ?? null,
      maxHeader: rules['header-max-length']?.value ?? null
    };
  }

  for (const name of HOOK_FILES) {
    const file = join(path, name);
    if (!(await exists(file))) continue;
    // The hook is a script. It can be run at commit time, but its rules cannot
    // be read out of it, so nothing is blocked before Git itself refuses.
    return {
      source: 'hook',
      file: name,
      enforced: false,
      rules: {},
      types: null,
      maxHeader: null
    };
  }

  return {
    source: 'none',
    file: null,
    enforced: false,
    rules: {},
    types: CONVENTIONAL_TYPES,
    maxHeader: null
  };
}

const HEADER = /^(?<type>[^(!:]+)(?:\((?<scope>[^)]*)\))?(?<bang>!)?: (?<subject>.*)$/;

/**
 * Check a message against the rules, returning problems in the order a person
 * reads the message: the shape first, then the parts.
 *
 * `blocking` is what turns the Commit button off. A commitlint level of 2 is
 * an error and blocks; level 1 is a warning and only informs.
 */
export function validateMessage(message, config) {
  const problems = [];
  const text = (message ?? '').replace(/\s+$/, '');
  const header = text.split('\n')[0] ?? '';

  if (!config?.enforced || !header.trim()) {
    return { ok: true, problems: [], blocking: [] };
  }

  const rules = config.rules ?? {};
  const add = (rule, text) => {
    const level = rules[rule]?.level ?? 2;
    if (level === 0) return;
    problems.push({ rule, message: text, level });
  };

  const match = header.match(HEADER);
  if (!match) {
    const form = rules['scope-empty']?.applicable === 'always' ? 'type: subject' : 'type(scope): subject';
    const shape = config.types?.length
      ? `${form} — for example "${config.types[0]}: short description"`
      : form;
    problems.push({
      rule: 'header-format',
      message: `The first line must read ${shape}`,
      level: 2
    });
  } else {
    const { type, scope, subject } = match.groups;

    if (rules['type-enum'] && Array.isArray(rules['type-enum'].value)) {
      const allowed = rules['type-enum'].value;
      if (!allowed.includes(type)) {
        add('type-enum', `"${type}" is not an allowed type. Use one of: ${allowed.join(', ')}`);
      }
    }
    if (rules['type-case']?.value === 'lower-case' && type !== type.toLowerCase()) {
      add('type-case', 'The type must be lower case');
    }
    if (rules['scope-enum'] && Array.isArray(rules['scope-enum'].value) && scope) {
      const allowed = rules['scope-enum'].value;
      if (allowed.length > 0 && !allowed.includes(scope)) {
        add('scope-enum', `"${scope}" is not an allowed scope. Use one of: ${allowed.join(', ')}`);
      }
    }
    if (rules['scope-empty']?.applicable === 'never' && !scope) {
      add('scope-empty', 'A scope is required, as in type(scope): subject');
    }
    // `always` reads as "the scope is always empty", so a scope is a fault.
    if (rules['scope-empty']?.applicable === 'always' && scope !== undefined) {
      add('scope-empty', `This repository does not use scopes, so drop "(${scope})"`);
    }
    if (rules['subject-empty']?.applicable === 'never' && !subject.trim()) {
      add('subject-empty', 'The subject cannot be empty');
    }
    if (rules['subject-full-stop']?.applicable === 'never') {
      const stop = rules['subject-full-stop'].value ?? '.';
      if (subject.endsWith(stop)) add('subject-full-stop', `The subject must not end with "${stop}"`);
    }
    if (rules['subject-case']?.value === 'lower-case' && subject && subject[0] !== subject[0].toLowerCase()) {
      add('subject-case', 'The subject must start lower case');
    }
  }

  const max = rules['header-max-length']?.value;
  if (typeof max === 'number' && header.length > max) {
    add('header-max-length', `The first line is ${header.length} characters, the limit is ${max}`);
  }

  const bodyMax = rules['body-max-line-length']?.value;
  if (typeof bodyMax === 'number') {
    const long = text.split('\n').slice(1).find((line) => line.length > bodyMax);
    if (long) add('body-max-line-length', `A body line is longer than ${bodyMax} characters`);
  }

  if (rules['body-leading-blank']?.applicable === 'always') {
    const lines = text.split('\n');
    if (lines.length > 1 && lines[1].trim() !== '') {
      add('body-leading-blank', 'Leave a blank line between the subject and the body');
    }
  }

  return {
    ok: problems.length === 0,
    problems,
    blocking: problems.filter((p) => p.level === 2)
  };
}
