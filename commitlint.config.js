/**
 * Commit message rules for this repository.
 *
 * Gitalia reads this file when it opens the repository and holds the Commit
 * panel to it, so the rules apply without commitlint being installed. Adding
 * @commitlint/cli and a commit-msg hook later would extend the same rules to
 * commits made from the terminal; nothing here would need to change.
 *
 * The conventional preset is the base. Subject capitalisation is deliberately
 * left alone: this history writes both "add shelving" and "add Stats section",
 * and a rule that rejected the second would be a change of style dressed up as
 * a lint rule.
 *
 * The rules below are stated in the shape Gitalia can read back — [level,
 * applicable, value] on one line — so that what the Commit panel enforces and
 * explains stays the same as what commitlint would enforce.
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // No scopes. This repository is small enough that the type and the subject
    // say everything a scope would, and a scope that is optional ends up used
    // inconsistently, which reads worse than never using one.
    'scope-empty': [2, 'always'],
    // The first line. The preset sets 100; 120 leaves room for a subject that
    // explains itself without inviting a paragraph.
    'header-max-length': [2, 'always', 120],
    // Body lines wrap at the width a terminal `git log` shows without folding.
    'body-max-line-length': [2, 'always', 100],
    'body-leading-blank': [2, 'always'],
    'footer-leading-blank': [2, 'always']
  }
};
