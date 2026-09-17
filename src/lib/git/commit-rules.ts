/**
 * Checking a commit message against the open repository's rules.
 *
 * The rules are read from the repository by the server when it opens (see
 * `server/commit-rules.mjs`). The checking lives here, on the client, because
 * it runs on every keystroke and a round trip per character would make the
 * message box feel slow.
 *
 * Only commitlint rules that can be both read and explained are applied. A
 * rule we did not understand is not enforced: blocking a commit the repository
 * would have accepted is a worse failure than missing a rule, because the user
 * cannot argue with a disabled button.
 */
import type { CommitRules, MessageCheck, MessageProblem } from './types';

const HEADER = /^(?<type>[^(!:]+)(?:\((?<scope>[^)]*)\))?(?<bang>!)?: (?<subject>.*)$/;

const PASS: MessageCheck = { ok: true, problems: [], blocking: [] };

/**
 * A one-line description of the rules, for the hint under the message box.
 *
 * The file the rules came from is not named here: the panel prints it after
 * the hint, so naming it in both places is what produced the stuttering
 * "commit-msg ... · commit-msg" hint.
 */
export function describeRules(config: CommitRules | null | undefined): string | null {
  if (!config) return null;
  // A hook is a script, so we cannot say what it does — only that it runs. It
  // may rewrite the message rather than check it, and it may accept anything,
  // which is why nothing is blocked before Git itself refuses.
  if (config.source === 'hook') {
    return 'runs on the message when you commit';
  }
  if (config.source !== 'commitlint') return null;

  const parts = ['type(scope): subject'];
  if (config.maxHeader) parts.push(`${config.maxHeader} characters max`);
  return parts.join(' · ');
}

export function checkMessage(
  message: string,
  config: CommitRules | null | undefined
): MessageCheck {
  const text = (message ?? '').replace(/\s+$/, '');
  const header = text.split('\n')[0] ?? '';

  // An empty box is not a violation: the Commit button is already off for it,
  // and showing an error before anything is typed would be nagging.
  if (!config?.enforced || !header.trim()) return PASS;

  const rules = config.rules ?? {};
  const problems: MessageProblem[] = [];

  const add = (rule: string, message: string) => {
    const level = rules[rule]?.level ?? 2;
    if (level === 0) return;
    problems.push({ rule, message, level });
  };

  const match = header.match(HEADER);
  if (!match?.groups) {
    const example = config.types?.length ? `${config.types[0]}: short description` : 'feat: short description';
    problems.push({
      rule: 'header-format',
      message: `The first line must read type(scope): subject — for example "${example}"`,
      level: 2
    });
  } else {
    const { type, scope, subject } = match.groups;

    const allowedTypes = rules['type-enum']?.value;
    if (Array.isArray(allowedTypes) && !allowedTypes.includes(type)) {
      add('type-enum', `"${type}" is not an allowed type. Use one of: ${allowedTypes.join(', ')}`);
    }
    if (rules['type-case']?.value === 'lower-case' && type !== type.toLowerCase()) {
      add('type-case', 'The type must be lower case');
    }

    const allowedScopes = rules['scope-enum']?.value;
    if (Array.isArray(allowedScopes) && allowedScopes.length > 0 && scope && !allowedScopes.includes(scope)) {
      add('scope-enum', `"${scope}" is not an allowed scope. Use one of: ${allowedScopes.join(', ')}`);
    }
    if (rules['scope-empty']?.applicable === 'never' && !scope) {
      add('scope-empty', 'A scope is required, as in type(scope): subject');
    }

    if (rules['subject-empty']?.applicable === 'never' && !subject.trim()) {
      add('subject-empty', 'The subject cannot be empty');
    }
    if (rules['subject-full-stop']?.applicable === 'never') {
      const stop = (rules['subject-full-stop'].value as string) ?? '.';
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
    const long = text.split('\n').slice(1).some((line) => line.length > bodyMax);
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
