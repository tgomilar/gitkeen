/**
 * Branch names are paths, so show them as one. `feature/login` and
 * `feature/ui` collapse under a `feature` folder, the way IntelliJ groups them.
 */
import type { Branch } from './git/types';

export interface TreeNode {
  /** Segment shown in the row. */
  name: string;
  /** Full prefix, used as a stable key for expand state. */
  path: string;
  children: TreeNode[];
  branch?: Branch;
}

function insert(root: TreeNode, branch: Branch) {
  const segments = branch.name.split('/');
  let node = root;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const path = segments.slice(0, i + 1).join('/');
    const leaf = i === segments.length - 1;
    let child = node.children.find((c) => c.name === segment && (leaf ? !!c.branch : !c.branch));
    if (!child) {
      child = { name: segment, path, children: [] };
      node.children.push(child);
    }
    if (leaf) child.branch = branch;
    node = child;
  }
}

function sort(node: TreeNode) {
  node.children.sort((a, b) => {
    const aFolder = a.children.length > 0;
    const bFolder = b.children.length > 0;
    if (aFolder !== bFolder) return aFolder ? -1 : 1; // folders first
    return a.name.localeCompare(b.name);
  });
  node.children.forEach(sort);
}

/**
 * Collapse folders that hold exactly one branch and nothing else, so a lone
 * `release/2.3.0` does not cost a whole row of indentation.
 */
function flattenSingles(node: TreeNode) {
  node.children = node.children.map((child) => {
    flattenSingles(child);
    if (!child.branch && child.children.length === 1) {
      const only = child.children[0];
      return { ...only, name: `${child.name}/${only.name}` };
    }
    return child;
  });
}

export function buildBranchTree(branches: Branch[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', children: [] };
  for (const branch of branches) insert(root, branch);
  sort(root);
  flattenSingles(root);
  return root.children;
}

/** Every branch under a node, used for folder counts. */
export function countBranches(node: TreeNode): number {
  return (node.branch ? 1 : 0) + node.children.reduce((sum, c) => sum + countBranches(c), 0);
}
