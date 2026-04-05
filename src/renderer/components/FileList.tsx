import React, { useState, useMemo } from 'react';

interface FileInfo {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  previous_filename?: string;
}

interface PRInfo {
  number: number;
  title: string;
  state: string;
  head: string;
  base: string;
  additions: number;
  deletions: number;
  changed_files: number;
}

interface FileListProps {
  files: FileInfo[];
  selectedFile: FileInfo | null;
  onSelectFile: (file: FileInfo) => void;
  pr: PRInfo;
  owner: string;
  repo: string;
  width: number;
}

const statusIcon: Record<string, string> = {
  added: 'A',
  removed: 'D',
  modified: 'M',
  renamed: 'R',
  copied: 'C',
};

const statusColor: Record<string, string> = {
  added: '#107c10',
  removed: '#c50f1f',
  modified: '#c19c00',
  renamed: '#0078d4',
  copied: '#0078d4',
};

// Tree node: either a folder or a file leaf
interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[];
  file?: FileInfo;
}

function buildTree(files: FileInfo[]): TreeNode {
  const root: TreeNode = { name: '', path: '', children: [] };

  for (const file of files) {
    const parts = file.filename.split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;
      const fullPath = parts.slice(0, i + 1).join('/');

      if (isFile) {
        current.children.push({ name: part, path: fullPath, children: [], file });
      } else {
        let folder = current.children.find((c) => !c.file && c.name === part);
        if (!folder) {
          folder = { name: part, path: fullPath, children: [] };
          current.children.push(folder);
        }
        current = folder;
      }
    }
  }

  // Sort: folders first (alphabetically), then files (alphabetically)
  const sortNodes = (node: TreeNode) => {
    node.children.sort((a, b) => {
      const aIsFolder = !a.file;
      const bIsFolder = !b.file;
      if (aIsFolder !== bIsFolder) return aIsFolder ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    node.children.forEach(sortNodes);
  };
  sortNodes(root);

  // Collapse single-child folders: src/components → src/components
  const collapse = (node: TreeNode): TreeNode => {
    node.children = node.children.map(collapse);
    if (!node.file && node.children.length === 1 && !node.children[0].file && node.name) {
      const child = node.children[0];
      return { ...child, name: `${node.name}/${child.name}` };
    }
    return node;
  };

  return collapse(root);
}

function FolderNode({
  node,
  depth,
  selectedFile,
  onSelectFile,
  expandedPaths,
  toggleExpand,
}: {
  node: TreeNode;
  depth: number;
  selectedFile: FileInfo | null;
  onSelectFile: (f: FileInfo) => void;
  expandedPaths: Set<string>;
  toggleExpand: (path: string) => void;
}) {
  const isExpanded = expandedPaths.has(node.path);

  return (
    <>
      <div
        className="tree-folder"
        style={{ paddingLeft: depth * 16 + 8 }}
        onClick={() => toggleExpand(node.path)}
      >
        <span className="tree-arrow">{isExpanded ? '▾' : '▸'}</span>
        <span className="tree-folder-icon">📁</span>
        <span className="tree-folder-name">{node.name}</span>
      </div>
      {isExpanded &&
        node.children.map((child) =>
          child.file ? (
            <FileNode
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedFile={selectedFile}
              onSelectFile={onSelectFile}
            />
          ) : (
            <FolderNode
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedFile={selectedFile}
              onSelectFile={onSelectFile}
              expandedPaths={expandedPaths}
              toggleExpand={toggleExpand}
            />
          ),
        )}
    </>
  );
}

function FileNode({
  node,
  depth,
  selectedFile,
  onSelectFile,
}: {
  node: TreeNode;
  depth: number;
  selectedFile: FileInfo | null;
  onSelectFile: (f: FileInfo) => void;
}) {
  const file = node.file!;
  const isActive = selectedFile?.filename === file.filename;

  return (
    <div
      className={`tree-file ${isActive ? 'tree-file-active' : ''}`}
      style={{ paddingLeft: depth * 16 + 8 }}
      onClick={() => onSelectFile(file)}
    >
      <span className="tree-file-icon">📄</span>
      <span className="tree-file-name" title={file.filename}>{node.name}</span>
      <span className="file-status" style={{ color: statusColor[file.status] || '#888' }}>
        {statusIcon[file.status] || '?'}
      </span>
      <span className="file-stats">
        {file.additions > 0 && <span className="stat-add">+{file.additions}</span>}
        {file.deletions > 0 && <span className="stat-del">-{file.deletions}</span>}
      </span>
    </div>
  );
}

// Collect all folder paths for initial expansion
function allFolderPaths(node: TreeNode): string[] {
  const paths: string[] = [];
  if (!node.file && node.path) paths.push(node.path);
  node.children.forEach((c) => paths.push(...allFolderPaths(c)));
  return paths;
}

export default function FileList({ files, selectedFile, onSelectFile, pr, owner, repo, width }: FileListProps) {
  const totalAdd = files.reduce((s, f) => s + f.additions, 0);
  const totalDel = files.reduce((s, f) => s + f.deletions, 0);

  const tree = useMemo(() => buildTree(files), [files]);

  // Start with all folders expanded
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    () => new Set(allFolderPaths(tree)),
  );

  const toggleExpand = (path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <div className="file-list" style={{ width, minWidth: 160, maxWidth: 600 }}>
      <div className="file-list-header">
        <div className="pr-badge">
          <span className={`pr-state pr-state-${pr.state}`}>{pr.state === 'open' ? '●' : '✓'}</span>
          <span className="pr-title-sm">{pr.title}</span>
          <span className="pr-number">#{pr.number}</span>
        </div>
        <div className="pr-branch-info">
          {owner}/{repo} • {pr.base} ← {pr.head}
        </div>
        <div className="file-summary">
          <span>{files.length} files changed</span>
          <span className="stat-add">+{totalAdd}</span>
          <span className="stat-del">-{totalDel}</span>
        </div>
      </div>
      <div className="file-items">
        {tree.children.map((child) =>
          child.file ? (
            <FileNode
              key={child.path}
              node={child}
              depth={0}
              selectedFile={selectedFile}
              onSelectFile={onSelectFile}
            />
          ) : (
            <FolderNode
              key={child.path}
              node={child}
              depth={0}
              selectedFile={selectedFile}
              onSelectFile={onSelectFile}
              expandedPaths={expandedPaths}
              toggleExpand={toggleExpand}
            />
          ),
        )}
      </div>
    </div>
  );
}
