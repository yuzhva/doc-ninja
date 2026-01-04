import type { FileSystemItem } from '../file-system-service.mjs';

/**
 * Helper to handle paths in a cross-platform way (Node & Browser)
 * without relying on the Node.js 'path' module which breaks in browsers.
 */
const PathHelper = {
  normalize(p: string) {
    // Replace backslashes with forward slashes for consistent processing
    return p.replace(/\\/g, '/');
  },

  relative(from: string, to: string) {
    const fromParts = this.normalize(from).split('/').filter(Boolean);
    const toParts = this.normalize(to).split('/').filter(Boolean);

    let i = 0;
    while (
      i < fromParts.length &&
      i < toParts.length &&
      fromParts[i] === toParts[i]
    ) {
      i++;
    }

    const up = fromParts.slice(i).map(() => '..');
    const down = toParts.slice(i);

    return [...up, ...down].join('/');
  },

  basename(p: string) {
    const parts = this.normalize(p).split('/');
    return parts[parts.length - 1];
  },

  join(base: string, part: string) {
    const baseNorm = this.normalize(base);
    const partNorm = this.normalize(part);
    const separator = '/';

    if (!baseNorm) return partNorm;
    if (!partNorm) return baseNorm;

    return baseNorm.endsWith(separator)
      ? baseNorm + partNorm
      : baseNorm + separator + partNorm;
  },
};

/**
 * Adds a file path to the directory tree structure.
 * Creates intermediate directory nodes as needed.
 */
function addScannedDirectoryPathToTree(
  rootNode: FileSystemItem,
  filePath: string,
  rootDirectoryPath: string,
  excludePattern: RegExp = /^\./, // Default: exclude folders starting with dot
): void {
  // Get relative path from root
  let relativePath = PathHelper.relative(rootDirectoryPath, filePath);

  if (relativePath.startsWith('..')) {
    // Fallback if path resolution is weird
    relativePath = PathHelper.basename(filePath);
  }

  const parts = relativePath.split('/');
  // Remove filename, keep directories
  parts.pop();

  // Check if any part of the path matches the exclude pattern
  if (parts.some((part) => excludePattern.test(part))) {
    return;
  }

  let currentNode = rootNode;

  let currentPath = rootDirectoryPath;

  for (const part of parts) {
    if (!part || part === '.') continue;

    currentPath = PathHelper.join(currentPath, part);

    if (!currentNode.fsNestedItems) currentNode.fsNestedItems = [];

    let child = currentNode.fsNestedItems.find((c) => c.name === part);
    if (!child) {
      child = {
        name: part,
        path: currentPath,
        fsItemType: 'directory',
        fsNestedItems: [],
      };
      currentNode.fsNestedItems.push(child);
    }

    currentNode = child;
  }
}

/**
 * Sorts the directory tree recursively by name.
 */
function sortDirectoryTree(node: FileSystemItem): void {
  if (node.fsNestedItems) {
    node.fsNestedItems.sort((a, b) => a.name.localeCompare(b.name));
    node.fsNestedItems.forEach(sortDirectoryTree);
  }
}

export { addScannedDirectoryPathToTree, sortDirectoryTree };
