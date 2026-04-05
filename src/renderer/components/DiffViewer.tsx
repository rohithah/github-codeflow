import React, { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import FindBar from './FindBar';

interface FileInfo {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  previous_filename?: string;
}

interface DiffViewerProps {
  file: FileInfo | null;
  viewMode: 'split' | 'unified';
  fullPatch: string | null;
  diffLoading: boolean;
  reviewThreads: any[];
  owner: string;
  repo: string;
  pr: { number: number; headSha: string } | null;
  onCommentPosted: () => Promise<void>;
  onAddPendingComment: (comment: { path: string; position: number; body: string; line: number; side: string }) => void;
  pendingComments: Array<{ path: string; position: number; body: string; line: number; side: string }>;
  showFindBar: boolean;
  onCloseFindBar: () => void;
}

interface DiffLine {
  type: 'add' | 'del' | 'context' | 'hunk';
  oldNum?: number;
  newNum?: number;
  content: string;
}

function parsePatch(patch: string): DiffLine[] {
  if (!patch) return [];
  const lines = patch.split('\n');
  const result: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/);
      if (match) {
        oldLine = parseInt(match[1], 10);
        newLine = parseInt(match[2], 10);
        result.push({ type: 'hunk', content: line });
      }
    } else if (line.startsWith('+')) {
      result.push({ type: 'add', newNum: newLine, content: line.substring(1) });
      newLine++;
    } else if (line.startsWith('-')) {
      result.push({ type: 'del', oldNum: oldLine, content: line.substring(1) });
      oldLine++;
    } else {
      result.push({ type: 'context', oldNum: oldLine, newNum: newLine, content: line.startsWith(' ') ? line.substring(1) : line });
      oldLine++;
      newLine++;
    }
  }
  return result;
}

// Render whitespace as visible dots/arrows like CodeFlow
function renderWhitespace(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let buffer = '';

  const flush = () => {
    if (buffer) {
      nodes.push(buffer);
      buffer = '';
    }
  };

  while (i < text.length) {
    if (text[i] === ' ') {
      flush();
      nodes.push(<span key={`ws-${i}`} className="ws-dot">·</span>);
    } else if (text[i] === '\t') {
      flush();
      nodes.push(<span key={`ws-${i}`} className="ws-tab">→{'   '}</span>);
    } else {
      buffer += text[i];
    }
    i++;
  }
  flush();
  return nodes;
}

interface SplitRow {
  left: DiffLine | null;
  right: DiffLine | null;
}

function toSplitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.type === 'hunk') {
      rows.push({ left: line, right: line });
      i++;
    } else if (line.type === 'context') {
      rows.push({ left: line, right: line });
      i++;
    } else if (line.type === 'del') {
      const dels: DiffLine[] = [];
      while (i < lines.length && lines[i].type === 'del') {
        dels.push(lines[i]);
        i++;
      }
      const adds: DiffLine[] = [];
      while (i < lines.length && lines[i].type === 'add') {
        adds.push(lines[i]);
        i++;
      }
      const maxLen = Math.max(dels.length, adds.length);
      for (let j = 0; j < maxLen; j++) {
        rows.push({
          left: j < dels.length ? dels[j] : null,
          right: j < adds.length ? adds[j] : null,
        });
      }
    } else if (line.type === 'add') {
      rows.push({ left: null, right: line });
      i++;
    } else {
      i++;
    }
  }
  return rows;
}

function SplitView({ lines }: { lines: DiffLine[] }) {
  const rows = useMemo(() => toSplitRows(lines), [lines]);

  return (
    <table className="diff-table diff-split">
      <colgroup>
        <col className="diff-marker-col" />
        <col className="diff-gutter-col" />
        <col className="diff-code-col" />
        <col className="diff-marker-col" />
        <col className="diff-gutter-col" />
        <col className="diff-code-col" />
      </colgroup>
      <tbody>
        {rows.map((row, i) => {
          if (row.left?.type === 'hunk') {
            return (
              <tr key={i} className="diff-hunk-row">
                <td colSpan={3} className="diff-hunk-cell">{row.left.content}</td>
                <td colSpan={3} className="diff-hunk-cell">{row.left.content}</td>
              </tr>
            );
          }
          const leftType = row.left?.type || '';
          const rightType = row.right?.type || '';
          return (
            <tr key={i}>
              <td className={`diff-marker ${leftType === 'del' ? 'marker-del' : ''}`}>
                {leftType === 'del' && <span className="marker-square marker-red" />}
              </td>
              <td className={`diff-gutter ${leftType === 'del' ? 'gutter-del' : ''}`}>{row.left?.oldNum ?? ''}</td>
              <td className={`diff-code ${leftType === 'del' ? 'code-del' : ''}`}>
                <pre>{row.left ? renderWhitespace(row.left.content) : ''}</pre>
              </td>
              <td className={`diff-marker ${rightType === 'add' ? 'marker-add' : ''}`}>
                {rightType === 'add' && <span className="marker-square marker-yellow" />}
              </td>
              <td className={`diff-gutter ${rightType === 'add' ? 'gutter-add' : ''}`}>{row.right?.newNum ?? ''}</td>
              <td className={`diff-code ${rightType === 'add' ? 'code-add' : ''}`}>
                <pre>{row.right ? renderWhitespace(row.right.content) : ''}</pre>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function InlineView({ lines, threads, onContextMenu, commentLineKey }: {
  lines: DiffLine[];
  threads: Map<string, any[]>;
  onContextMenu: (e: React.MouseEvent, line: DiffLine, idx: number) => void;
  commentLineKey: string | null;
}) {
  return (
    <table className="diff-table diff-inline">
      <colgroup>
        <col className="diff-marker-col" />
        <col className="diff-gutter-col" />
        <col className="diff-code-col" />
      </colgroup>
      <tbody>
        {lines.map((line, i) => {
          if (line.type === 'hunk') {
            return (
              <tr key={i} className="diff-hunk-row">
                <td colSpan={3} className="diff-hunk-cell">{line.content}</td>
              </tr>
            );
          }
          const isDel = line.type === 'del';
          const isAdd = line.type === 'add';
          const lineNum = isDel ? line.oldNum : (line.newNum ?? line.oldNum);
          const lineKey = `${line.type === 'del' ? 'LEFT' : 'RIGHT'}:${lineNum}`;
          const lineThreads = threads.get(lineKey) || [];
          const showInput = commentLineKey === lineKey;

          return (
            <React.Fragment key={i}>
              <tr
                className={isDel ? 'row-del' : isAdd ? 'row-add' : ''}
                onContextMenu={(e) => onContextMenu(e, line, i)}
              >
                <td className={`diff-marker ${isDel ? 'marker-del' : isAdd ? 'marker-add' : ''}`}>
                  {isDel && <span className="marker-square marker-red" />}
                  {isAdd && <span className="marker-square marker-yellow" />}
                </td>
                <td className={`diff-gutter ${isDel ? 'gutter-del' : isAdd ? 'gutter-add' : ''}`}>
                  {lineNum ?? ''}
                </td>
                <td className={`diff-code ${isDel ? 'code-del' : isAdd ? 'code-add' : ''}`}>
                  <pre>{renderWhitespace(line.content)}</pre>
                </td>
              </tr>
              {(lineThreads.length > 0 || showInput) && (
                <tr className="comment-row">
                  <td colSpan={3} className="comment-cell" id={`comment-anchor-${lineKey}`} />
                </tr>
              )}
            </React.Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

// Comment thread component rendered as a portal/overlay anchored to a line
function CommentThread({ thread, owner, repo, prNumber, onReplyPosted }: {
  thread: any;
  owner: string;
  repo: string;
  prNumber: number;
  onReplyPosted: () => Promise<void>;
}) {
  const [replyText, setReplyText] = useState('');
  const [showReply, setShowReply] = useState(false);
  const [posting, setPosting] = useState(false);

  const handleReply = async () => {
    if (!replyText.trim()) return;
    setPosting(true);
    const result = await window.api.replyToComment(owner, repo, prNumber, replyText.trim(), thread.id);
    if (result.success) {
      setReplyText('');
      setShowReply(false);
      await onReplyPosted();
    }
    setPosting(false);
  };

  const timeAgo = (d: string) => {
    const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  };

  return (
    <div className="comment-thread">
      {thread.comments.map((c: any) => (
        <div key={c.id} className="comment-entry">
          <div className="comment-header">
            {c.avatar && <img src={c.avatar} className="comment-avatar" alt="" />}
            <span className="comment-author">{c.user}</span>
            <span className="comment-time">{timeAgo(c.created_at)}</span>
          </div>
          <div className="comment-body">{c.body}</div>
        </div>
      ))}
      {showReply ? (
        <div className="comment-reply-box">
          <textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Write a reply..."
            rows={3}
            autoFocus
          />
          <div className="comment-reply-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => setShowReply(false)}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={handleReply} disabled={posting || !replyText.trim()}>
              {posting ? 'Posting...' : 'Reply'}
            </button>
          </div>
        </div>
      ) : (
        <button className="btn btn-ghost btn-sm comment-reply-btn" onClick={() => setShowReply(true)}>
          💬 Reply
        </button>
      )}
    </div>
  );
}

// New comment input for a specific line
function NewCommentInput({ onSubmit, onCancel, error }: {
  onSubmit: (body: string) => Promise<void>;
  onCancel: () => void;
  error: string | null;
}) {
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);

  const handleSubmit = async () => {
    if (!text.trim()) return;
    setPosting(true);
    await onSubmit(text.trim());
    setPosting(false);
  };

  return (
    <div className="comment-thread comment-new">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Add a review comment..."
        rows={3}
        autoFocus
      />
      {error && <div className="comment-error">⚠ {error}</div>}
      <div className="comment-reply-actions">
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary btn-sm" onClick={handleSubmit} disabled={posting || !text.trim()}>
          {posting ? 'Posting...' : 'Comment'}
        </button>
      </div>
    </div>
  );
}

// Context menu
function ContextMenu({ x, y, onAddComment, onClose }: {
  x: number;
  y: number;
  onAddComment: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const handler = () => onClose();
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [onClose]);

  return (
    <div className="context-menu" style={{ left: x, top: y }}>
      <div className="context-menu-item" onClick={onAddComment}>💬 Add Comment</div>
    </div>
  );
}

// Compute indices where each change group starts
function getChangeGroupIndices(lines: DiffLine[]): number[] {
  const indices: number[] = [];
  let inChange = false;
  for (let i = 0; i < lines.length; i++) {
    const isChange = lines[i].type === 'add' || lines[i].type === 'del';
    if (isChange && !inChange) {
      indices.push(i);
      inChange = true;
    } else if (!isChange) {
      inChange = false;
    }
  }
  return indices;
}

export default function DiffViewer({ file, viewMode, fullPatch, diffLoading, reviewThreads, owner, repo, pr, onCommentPosted, onAddPendingComment, pendingComments, showFindBar, onCloseFindBar }: DiffViewerProps) {
  const patchSource = fullPatch || file?.patch || '';
  const lines = useMemo(() => (patchSource ? parsePatch(patchSource) : []), [patchSource]);
  const changeIndices = useMemo(() => getChangeGroupIndices(lines), [lines]);
  const [currentChangeIdx, setCurrentChangeIdx] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; line: DiffLine; idx: number } | null>(null);
  const [commentLineKey, setCommentLineKey] = useState<string | null>(null);
  const [localThreads, setLocalThreads] = useState<any[]>([]);

  // Build pending comments map for this file
  const pendingByLine = useMemo(() => {
    const map = new Map<string, any[]>();
    if (!file) return map;
    for (const c of pendingComments) {
      if (c.path === file.filename) {
        const key = `${c.side}:${c.line}`;
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(c);
      }
    }
    return map;
  }, [pendingComments, file?.filename]);

  // Build a map of line -> threads for the current file (API threads + pending local comments)
  const threadsByLine = useMemo(() => {
    const map = new Map<string, any[]>();
    if (!file) return map;
    for (const t of reviewThreads) {
      if (t.path === file.filename && t.line) {
        const key = `${t.side || 'RIGHT'}:${t.line}`;
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(t);
      }
    }
    return map;
  }, [reviewThreads, file?.filename]);

  useEffect(() => {
    setCurrentChangeIdx(0);
    setCommentLineKey(null);
    setContextMenu(null);
  }, [file?.filename, fullPatch]);

  const scrollToChange = useCallback((idx: number) => {
    if (!contentRef.current || changeIndices.length === 0) return;
    const clamped = Math.max(0, Math.min(idx, changeIndices.length - 1));
    setCurrentChangeIdx(clamped);
    const rowIndex = changeIndices[clamped];
    const table = contentRef.current.querySelector('.diff-table');
    if (!table) return;
    const rows = table.querySelectorAll('tbody tr');
    if (rows[rowIndex]) {
      rows[rowIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [changeIndices]);

  const goNext = useCallback(() => scrollToChange(currentChangeIdx + 1), [currentChangeIdx, scrollToChange]);
  const goPrev = useCallback(() => scrollToChange(currentChangeIdx - 1), [currentChangeIdx, scrollToChange]);

  const handleContextMenu = useCallback((e: React.MouseEvent, line: DiffLine, _idx: number) => {
    if (line.type === 'hunk') return;
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, line, idx: _idx });
  }, []);

  const handleAddComment = useCallback(() => {
    if (!contextMenu) return;
    const line = contextMenu.line;
    const lineNum = line.type === 'del' ? line.oldNum : (line.newNum ?? line.oldNum);
    const side = line.type === 'del' ? 'LEFT' : 'RIGHT';
    const key = `${side}:${lineNum}`;
    setCommentLineKey(key);
    setContextMenu(null);
  }, [contextMenu]);

  const [commentError, setCommentError] = useState<string | null>(null);

  const handleSubmitComment = useCallback(async (body: string) => {
    if (!file || !pr || !commentLineKey) return;
    const [side, lineStr] = commentLineKey.split(':');
    const lineNum = parseInt(lineStr, 10);
    setCommentError(null);

    // Add to pending review on GitHub (GraphQL)
    const result = await window.api.createReviewComment(owner, repo, pr.number, body, pr.headSha, file.filename, lineNum, side, file.patch || '');

    if (!result.success) {
      setCommentError(result.error || 'Cannot comment on this line');
      return;
    }

    // Add to local pending list for display
    onAddPendingComment({
      path: file.filename,
      position: 0,
      body,
      line: lineNum,
      side,
    });
    setCommentLineKey(null);
    setCommentError(null);
  }, [file, pr, commentLineKey, owner, repo, onAddPendingComment]);

  if (!file) {
    return (
      <div className="diff-viewer diff-empty">
        <p>Select a file to view its diff</p>
      </div>
    );
  }

  if (diffLoading) {
    return (
      <div className="diff-viewer diff-empty">
        <div className="spinner" />
        <p>Loading full file diff...</p>
      </div>
    );
  }

  if (!file.patch && !fullPatch) {
    return (
      <div className="diff-viewer diff-empty">
        <p>No diff available for this file</p>
        <p className="diff-empty-hint">
          {file.status === 'removed'
            ? 'This file was deleted'
            : file.status === 'renamed'
            ? `Renamed from ${file.previous_filename}`
            : 'Binary file or file too large to display'}
        </p>
      </div>
    );
  }

  // Collect all line keys that have threads, pending comments, or new comment input
  const allCommentKeys = new Set<string>();
  threadsByLine.forEach((_, key) => allCommentKeys.add(key));
  pendingByLine.forEach((_, key) => allCommentKeys.add(key));
  if (commentLineKey) allCommentKeys.add(commentLineKey);

  // Build inline comment elements keyed by line
  const commentElements = new Map<string, React.ReactNode>();
  for (const key of allCommentKeys) {
    const keyThreads = threadsByLine.get(key) || [];
    const keyPending = pendingByLine.get(key) || [];
    commentElements.set(
      key,
      <div className="comment-block">
        {keyThreads.map((t: any) => (
          <CommentThread key={t.id} thread={t} owner={owner} repo={repo} prNumber={pr!.number} onReplyPosted={onCommentPosted} />
        ))}
        {keyPending.map((c: any, i: number) => (
          <div key={`pending-${i}`} className="comment-thread comment-pending">
            <div className="comment-entry">
              <div className="comment-header">
                <span className="comment-pending-badge">Pending</span>
              </div>
              <div className="comment-body">{c.body}</div>
            </div>
          </div>
        ))}
        {commentLineKey === key && (
          <NewCommentInput onSubmit={handleSubmitComment} onCancel={() => { setCommentLineKey(null); setCommentError(null); }} error={commentError} />
        )}
      </div>,
    );
  }

  return (
    <div className="diff-viewer">
      <div className="diff-file-header">
        <div className="diff-file-icon">📄</div>
        <span className="diff-filename">{file.filename}</span>
        {file.previous_filename && (
          <span className="diff-renamed">← {file.previous_filename}</span>
        )}
        <div className="diff-file-stats">
          <span className="stat-add">+{file.additions}</span>
          <span className="stat-del">-{file.deletions}</span>
        </div>
        {changeIndices.length > 0 && (
          <div className="diff-nav">
            <button className="btn btn-sm btn-nav" onClick={goPrev} disabled={currentChangeIdx <= 0} title="Previous change">
              ▲
            </button>
            <span className="diff-nav-label">{currentChangeIdx + 1} / {changeIndices.length}</span>
            <button className="btn btn-sm btn-nav" onClick={goNext} disabled={currentChangeIdx >= changeIndices.length - 1} title="Next change">
              ▼
            </button>
          </div>
        )}
      </div>
      <FindBar visible={showFindBar} onClose={onCloseFindBar} contentRef={contentRef} />
      <div className="diff-content" ref={contentRef}>
        {viewMode === 'split'
          ? <SplitView lines={lines} />
          : <InlineViewWithComments lines={lines} threads={threadsByLine} onContextMenu={handleContextMenu} commentLineKey={commentLineKey} commentElements={commentElements} />}
      </div>
      {contextMenu && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y} onAddComment={handleAddComment} onClose={() => setContextMenu(null)} />
      )}
    </div>
  );
}

// Inline view that renders comment blocks between rows
function InlineViewWithComments({ lines, threads, onContextMenu, commentLineKey, commentElements }: {
  lines: DiffLine[];
  threads: Map<string, any[]>;
  onContextMenu: (e: React.MouseEvent, line: DiffLine, idx: number) => void;
  commentLineKey: string | null;
  commentElements: Map<string, React.ReactNode>;
}) {
  return (
    <table className="diff-table diff-inline">
      <colgroup>
        <col className="diff-marker-col" />
        <col className="diff-gutter-col" />
        <col className="diff-code-col" />
      </colgroup>
      <tbody>
        {lines.map((line, i) => {
          if (line.type === 'hunk') {
            return (
              <tr key={i} className="diff-hunk-row">
                <td colSpan={3} className="diff-hunk-cell">{line.content}</td>
              </tr>
            );
          }
          const isDel = line.type === 'del';
          const isAdd = line.type === 'add';
          const lineNum = isDel ? line.oldNum : (line.newNum ?? line.oldNum);
          const side = isDel ? 'LEFT' : 'RIGHT';
          const lineKey = `${side}:${lineNum}`;
          const hasComments = commentElements.has(lineKey);

          return (
            <React.Fragment key={i}>
              <tr
                className={isDel ? 'row-del' : isAdd ? 'row-add' : ''}
                onContextMenu={(e) => onContextMenu(e, line, i)}
              >
                <td className={`diff-marker ${isDel ? 'marker-del' : isAdd ? 'marker-add' : ''}`}>
                  {isDel && <span className="marker-square marker-red" />}
                  {isAdd && <span className="marker-square marker-yellow" />}
                </td>
                <td className={`diff-gutter ${isDel ? 'gutter-del' : isAdd ? 'gutter-add' : ''}`}>
                  {lineNum ?? ''}
                </td>
                <td className={`diff-code ${isDel ? 'code-del' : isAdd ? 'code-add' : ''}`}>
                  <pre>{renderWhitespace(line.content)}</pre>
                </td>
              </tr>
              {hasComments && (
                <tr className="comment-row">
                  <td colSpan={3} className="comment-cell">
                    {commentElements.get(lineKey)}
                  </td>
                </tr>
              )}
            </React.Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
