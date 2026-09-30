#!/usr/bin/env bash
# Build the demo repository the screenshots in docs/media are made from.
#
#   scripts/demo-repo.sh <folder>
#
# The folder is deleted and made again, so every run gives the same history:
# a small notes app with a few contributors, merged feature branches, tags, a
# remote, an open feature branch, and a branch that conflicts with main.
set -euo pipefail

dir=${1:?usage: scripts/demo-repo.sh <folder>}
rm -rf "$dir" "$dir.remote"
mkdir -p "$dir"
cd "$dir"

git init -q -b main
git config user.name "Ana Novak"
git config user.email "ana@lumen.dev"
git config commit.gpgsign false
git config tag.gpgsign false

day=0
commit() { # commit <author> <email> <message>
  day=$((day + 1))
  local when="2026-08-$(printf %02d $(( (day % 28) + 1 )))T$(printf %02d $(( 9 + day % 8 ))):$(printf %02d $(( (day * 7) % 60 ))):00"
  git add -A
  GIT_AUTHOR_NAME="$1" GIT_AUTHOR_EMAIL="$2" GIT_COMMITTER_NAME="$1" GIT_COMMITTER_EMAIL="$2" \
    GIT_AUTHOR_DATE="$when" GIT_COMMITTER_DATE="$when" git commit -q -m "$3"
}
merge() { # merge <branch> <message>
  day=$((day + 1))
  local when="2026-08-$(printf %02d $(( (day % 28) + 1 )))T16:30:00"
  GIT_AUTHOR_NAME="Ana Novak" GIT_AUTHOR_EMAIL="ana@lumen.dev" GIT_COMMITTER_NAME="Ana Novak" GIT_COMMITTER_EMAIL="ana@lumen.dev" \
    GIT_AUTHOR_DATE="$when" GIT_COMMITTER_DATE="$when" git merge -q --no-ff "$1" -m "$2"
}
tag() { # tag <name> <message>
  GIT_COMMITTER_NAME="Ana Novak" GIT_COMMITTER_EMAIL="ana@lumen.dev" git tag -a "$1" -m "$2"
}

ANA=("Ana Novak" "ana@lumen.dev")
MARCO=("Marco Rossi" "marco@lumen.dev")
PRIYA=("Priya Shah" "priya@lumen.dev")
LIAM=("Liam Chen" "liam@lumen.dev")

mkdir -p src
cat > README.md <<'EOF'
# Lumen

A small app for writing notes in the browser.
EOF
cat > package.json <<'EOF'
{
  "name": "lumen",
  "version": "0.1.0",
  "scripts": { "start": "node src/server.js" }
}
EOF
commit "${ANA[@]}" "chore: start the Lumen notes app"

cat > src/notes.js <<'EOF'
export function createNote(title, body) {
  return { id: crypto.randomUUID(), title, body, created: Date.now() };
}

export function sortNotes(notes) {
  return [...notes].sort((a, b) => b.created - a.created);
}
EOF
commit "${ANA[@]}" "feat: create and sort notes"

cat > src/server.js <<'EOF'
import { createServer } from 'node:http';

const port = process.env.PORT ?? 3000;

createServer((req, res) => {
  res.end('Lumen');
}).listen(port);
EOF
commit "${MARCO[@]}" "feat: serve the app over HTTP"

cat > styles.css <<'EOF'
body {
  font-family: system-ui, sans-serif;
  background: #ffffff;
  color: #1c1c1f;
}

.note {
  padding: 12px;
  border-radius: 6px;
}
EOF
commit "${PRIYA[@]}" "style: add the base styles"
tag v0.1.0 "First preview"

git switch -q -c feature/editor
cat > src/editor.js <<'EOF'
import { createNote } from './notes.js';

export function openEditor(root) {
  const title = root.querySelector('.title');
  const body = root.querySelector('.body');

  function save() {
    return createNote(title.value, body.value);
  }

  return { save };
}
EOF
commit "${PRIYA[@]}" "feat: add the note editor"
cat >> src/editor.js <<'EOF'

export function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
EOF
commit "${PRIYA[@]}" "feat: count the words in a note"
git switch -q main

cat >> README.md <<'EOF'

## Running it

    npm start
EOF
commit "${LIAM[@]}" "docs: explain how to start the app"
merge feature/editor "Merge branch 'feature/editor'"

git switch -q -c feature/tags
cat > src/tags.js <<'EOF'
export function parseTags(body) {
  return [...body.matchAll(/#(\w+)/g)].map((m) => m[1]);
}
EOF
commit "${MARCO[@]}" "feat: read #tags from a note"
cat >> src/tags.js <<'EOF'

export function byTag(notes, tag) {
  return notes.filter((n) => parseTags(n.body).includes(tag));
}
EOF
commit "${MARCO[@]}" "feat: filter notes by tag"
git switch -q main
sed -i.bak 's/res.end(.Lumen.);/res.setHeader("content-type", "text\/html");\n  res.end("<h1>Lumen<\/h1>");/' src/server.js && rm src/server.js.bak
commit "${ANA[@]}" "fix: send the page as HTML"
merge feature/tags "Merge branch 'feature/tags'"

cat >> src/notes.js <<'EOF'

export function deleteNote(notes, id) {
  return notes.filter((n) => n.id !== id);
}
EOF
commit "${LIAM[@]}" "feat: delete a note"
sed -i.bak 's/"version": "0.1.0"/"version": "0.2.0"/' package.json && rm package.json.bak
commit "${ANA[@]}" "chore: release 0.2.0"
tag v0.2.0 "Tags and the editor"

# Three small commits in a row, the kind worth squashing.
cat > src/export.js <<'EOF'
export function exportNote(note) {
  return `# ${note.title}\n\n${note.body}\n`;
}
EOF
commit "${PRIYA[@]}" "feat: add an export button"
sed -i.bak 's/export function exportNote/export function exportMarkdown/' src/export.js && rm src/export.js.bak
commit "${PRIYA[@]}" "fix: rename the export function"
cat >> src/export.js <<'EOF'

export function exportFileName(note) {
  return `${note.title.toLowerCase().replace(/\s+/g, '-')}.md`;
}
EOF
commit "${PRIYA[@]}" "wip: name the exported file"

cat >> styles.css <<'EOF'

.toolbar {
  display: flex;
  gap: 8px;
}
EOF
commit "${MARCO[@]}" "style: lay out the toolbar"
cat >> src/notes.js <<'EOF'

export function pinNote(note) {
  return { ...note, pinned: true };
}
EOF
commit "${LIAM[@]}" "feat: pin a note to the top"

# A remote, so the graph shows remote branches. It has main only up to
# v0.2.0, so the commits after it are not pushed and can be rewritten freely.
git clone -q --bare . "$dir.remote"
git -C "$dir.remote" update-ref refs/heads/main "v0.2.0^{commit}"
git remote add origin "$dir.remote"
git fetch -q origin
git branch -q -u origin/main main

# An open feature branch, pushed. It starts at v0.2.0, so the commits on
# main after that belong to main alone and rewriting them leaves no copies.
git switch -q -c feature/search v0.2.0
cat > src/search.js <<'EOF'
export function search(notes, query) {
  const q = query.toLowerCase();
  return notes.filter((n) => n.title.toLowerCase().includes(q));
}
EOF
commit "${MARCO[@]}" "feat: search notes by title"
sed -i.bak 's/n.title.toLowerCase().includes(q)/(n.title + " " + n.body).toLowerCase().includes(q)/' src/search.js && rm src/search.js.bak
commit "${MARCO[@]}" "feat: search the body too"
git push -q -u origin feature/search

# A branch that changes the same lines of styles.css as main will.
git switch -q -c feature/dark-mode v0.2.0
sed -i.bak 's/background: #ffffff;/background: #1e1e1e;/; s/color: #1c1c1f;/color: #e3e3e6;/' styles.css && rm styles.css.bak
commit "${PRIYA[@]}" "feat: add a dark theme"

git switch -q main
sed -i.bak 's/background: #ffffff;/background: #fafafa;/; s/color: #1c1c1f;/color: #222222;/' styles.css && rm styles.css.bak
commit "${ANA[@]}" "style: soften the page colours"
cat >> src/server.js <<'EOF'

console.log(`Lumen runs on http://localhost:${port}`);
EOF
commit "${LIAM[@]}" "feat: say where the app runs"
git gc -q --prune=now
