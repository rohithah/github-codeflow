import React, { useMemo, useState } from 'react';

export interface ReviewComment {
  id: number;
  body: string;
  user: string;
  avatar?: string;
  created_at: string;
  reviewState: 'PENDING' | 'SUBMITTED' | string;
}

export interface ReviewThread {
  id: number;
  nodeId: string;
  path: string;
  line: number | null;
  currentLine: number | null;
  originalLine: number | null;
  side: 'LEFT' | 'RIGHT';
  isResolved: boolean;
  isOutdated: boolean;
  resolvedBy?: string;
  reviewState: 'PENDING' | 'SUBMITTED' | string;
  comments: ReviewComment[];
}

export interface PendingComment {
  path: string;
  body: string;
  line: number;
  side: string;
}

export interface CommentNavigationItem {
  id: string;
  path: string;
  line: number | null;
  side: 'LEFT' | 'RIGHT';
}

interface CommentListItem extends CommentNavigationItem {
  body: string;
  user: string;
  avatar?: string;
  createdAt?: string;
  replyCount: number;
  isPending: boolean;
  isResolved: boolean;
  isOutdated: boolean;
  resolvedBy?: string;
}

type Filter = 'all' | 'open' | 'resolved' | 'pending' | 'outdated';

interface Props {
  threads: ReviewThread[];
  pendingComments: PendingComment[];
  selectedId: string | null;
  onSelect: (item: CommentNavigationItem) => void;
  onClose: () => void;
}

function relativeTime(value?: string): string {
  if (!value) return 'just now';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(value).toLocaleDateString();
}

export default function CommentsNavigator({ threads, pendingComments, selectedId, onSelect, onClose }: Props) {
  const [filter, setFilter] = useState<Filter>('all');

  const items = useMemo<CommentListItem[]>(() => {
    const serverItems = threads.map((thread) => {
      const root = thread.comments[0];
      return {
        id: `thread:${thread.nodeId || thread.id}`,
        path: thread.path,
        line: thread.currentLine || thread.originalLine || thread.line,
        side: thread.side || 'RIGHT',
        body: root?.body || '',
        user: root?.user || 'ghost',
        avatar: root?.avatar,
        createdAt: root?.created_at,
        replyCount: Math.max(0, thread.comments.length - 1),
        isPending: thread.reviewState === 'PENDING',
        isResolved: thread.isResolved,
        isOutdated: thread.isOutdated,
        resolvedBy: thread.resolvedBy,
      } as CommentListItem;
    });

    const localItems = pendingComments
      .filter((pending) => !serverItems.some((item) =>
        item.isPending &&
        item.path === pending.path &&
        item.line === pending.line &&
        item.body === pending.body))
      .map((pending, index) => ({
        id: `pending:${pending.path}:${pending.side}:${pending.line}:${index}`,
        path: pending.path,
        line: pending.line,
        side: pending.side === 'LEFT' ? 'LEFT' as const : 'RIGHT' as const,
        body: pending.body,
        user: 'You',
        replyCount: 0,
        isPending: true,
        isResolved: false,
        isOutdated: false,
      }));

    return [...serverItems, ...localItems].sort((a, b) =>
      a.path.localeCompare(b.path) || (a.line || 0) - (b.line || 0));
  }, [threads, pendingComments]);

  const counts = {
    all: items.length,
    open: items.filter((item) => !item.isPending && !item.isResolved).length,
    resolved: items.filter((item) => item.isResolved).length,
    pending: items.filter((item) => item.isPending).length,
    outdated: items.filter((item) => item.isOutdated).length,
  };

  const visibleItems = items.filter((item) => {
    if (filter === 'open') return !item.isPending && !item.isResolved;
    if (filter === 'resolved') return item.isResolved;
    if (filter === 'pending') return item.isPending;
    if (filter === 'outdated') return item.isOutdated;
    return true;
  });

  const grouped = visibleItems.reduce<Record<string, CommentListItem[]>>((result, item) => {
    (result[item.path] ||= []).push(item);
    return result;
  }, {});

  return (
    <div className="comments-panel" onKeyDown={(event) => event.key === 'Escape' && onClose()}>
      <div className="comments-panel-header">
        <span className="comments-panel-title">Comments ({items.length})</span>
        <button className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Close comments">✕</button>
      </div>
      <div className="comments-filters">
        {(['all', 'open', 'resolved', 'pending', 'outdated'] as Filter[]).map((name) => (
          <button
            key={name}
            className={`comments-filter ${filter === name ? 'comments-filter-active' : ''}`}
            onClick={() => setFilter(name)}
          >
            {name[0].toUpperCase() + name.slice(1)} {counts[name]}
          </button>
        ))}
      </div>
      <div className="comments-list">
        {visibleItems.length === 0 && <div className="comments-empty">No {filter === 'all' ? '' : `${filter} `}comments</div>}
        {Object.entries(grouped).map(([path, fileItems]) => (
          <div className="comments-file-group" key={path}>
            <div className="comments-file-name">📄 {path}</div>
            {fileItems.map((item) => (
              <button
                key={item.id}
                className={`comments-item ${selectedId === item.id ? 'comments-item-selected' : ''}`}
                onClick={() => onSelect(item)}
              >
                <div className="comments-item-meta">
                  {item.isPending
                    ? <span className="comment-status status-pending">Pending</span>
                    : item.isResolved
                      ? <span className="comment-status status-resolved">Resolved</span>
                      : <span className="comment-status status-open">Open</span>}
                  {item.isOutdated && <span className="comment-status status-outdated">Outdated</span>}
                  <span>line {item.line || 'unknown'}</span>
                  {item.replyCount > 0 && <span>{item.replyCount} {item.replyCount === 1 ? 'reply' : 'replies'}</span>}
                </div>
                <div className="comments-item-body">{item.body}</div>
                <div className="comments-item-author">
                  {item.avatar && <img src={item.avatar} alt="" />}
                  <span>@{item.user}</span>
                  <span>{relativeTime(item.createdAt)}</span>
                  {item.resolvedBy && <span>resolved by @{item.resolvedBy}</span>}
                </div>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
