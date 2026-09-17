/**
 * Commit message rules for this repository.
 *
 * Gitalia reads this file when it opens the repository and holds the Commit
 * panel to it, so the rules apply without commitlint being installed. Adding
 * @commitlint/cli and a commit-msg hook later would extend the same rules to
 * commits made from the terminal; nothing here would need to change.
 *
 * The conventional preset is taken as it comes. Subject capitalisation is
 * deliberately left alone: this history writes both "add shelving" and "add
 * Stats section", and a rule that rejected the second would be a change of
 * style dressed up as a lint rule.
 */
export default {
  extends: ['@commitlint/config-conventional']
};
