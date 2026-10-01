// The files in ../docs link to each other as "undo.md#restoring" and to their
// pictures as "media/undo.gif", which works on GitHub. This turns those links
// into the site's own addresses.
import { visit } from 'unist-util-visit';

const repo = 'https://github.com/tgomilar/gitkeen/blob/main/';

export function rewriteDocLinks({ base }) {
  return (tree) => {
    visit(tree, ['link', 'image', 'definition'], (node) => {
      node.url = rewrite(node.url, base);
    });
  };
}

function rewrite(url, base) {
  if (/^([a-z]+:|#|\/)/i.test(url)) return url;
  if (url.startsWith('media/')) return `${base}/${url}`;
  const page = url.match(/^([\w-]+)\.md(#.*)?$/);
  if (page) return `${base}/docs/${page[1]}/${page[2] ?? ''}`;
  return new URL(url, `${repo}docs/`).href;
}
