import React, { useState } from 'react';

export interface Iteration {
  number: number;
  baseSha: string;
  headSha: string;
  commitCount: number;
  pushedAt: string;
  commits: Array<{ sha: string; shortSha: string; message: string; author: string }>;
}

export type ActiveRange =
  | { kind: 'all'; baseSha: string; headSha: string }
  | { kind: 'iteration'; iteration: Iteration }
  | { kind: 'compare'; from: Iteration; to: Iteration };

interface Props {
  iterations: Iteration[];
  active: ActiveRange;
  onSelect: (range: ActiveRange) => void;
  prBaseSha: string;
  prHeadSha: string;
}

function isSameRange(a: ActiveRange, b: ActiveRange): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'all' && b.kind === 'all') return true;
  if (a.kind === 'iteration' && b.kind === 'iteration') return a.iteration.number === b.iteration.number;
  if (a.kind === 'compare' && b.kind === 'compare')
    return a.from.number === b.from.number && a.to.number === b.to.number;
  return false;
}

function formatPushedAt(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString();
}

export default function IterationTabs({ iterations, active, onSelect, prBaseSha, prHeadSha }: Props) {
  const [dragSrc, setDragSrc] = useState<Iteration | null>(null);
  const [dragOverNum, setDragOverNum] = useState<number | null>(null);

  const allRange: ActiveRange = { kind: 'all', baseSha: prBaseSha, headSha: prHeadSha };

  const onDragStart = (e: React.DragEvent, iter: Iteration) => {
    setDragSrc(iter);
    e.dataTransfer.effectAllowed = 'link';
    e.dataTransfer.setData('text/plain', String(iter.number));
  };

  const onDragOver = (e: React.DragEvent, iter: Iteration) => {
    if (!dragSrc || dragSrc.number === iter.number) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'link';
    setDragOverNum(iter.number);
  };

  const onDragLeave = () => setDragOverNum(null);

  const onDrop = (e: React.DragEvent, target: Iteration) => {
    e.preventDefault();
    if (dragSrc && dragSrc.number !== target.number) {
      const [from, to] = dragSrc.number < target.number ? [dragSrc, target] : [target, dragSrc];
      onSelect({ kind: 'compare', from, to });
    }
    setDragSrc(null);
    setDragOverNum(null);
  };

  const onDragEnd = () => {
    setDragSrc(null);
    setDragOverNum(null);
  };

  return (
    <div className="iteration-tabs" role="tablist">
      <button
        role="tab"
        className={`iter-tab ${active.kind === 'all' ? 'iter-tab-active' : ''}`}
        onClick={() => onSelect(allRange)}
        title="Show full PR diff (base → head)"
      >
        All
      </button>

      {iterations.map((iter) => {
        const isActive =
          (active.kind === 'iteration' && active.iteration.number === iter.number);
        const isDragOver = dragOverNum === iter.number;
        const tooltip = `Iteration ${iter.number} · ${iter.commitCount} commit${iter.commitCount === 1 ? '' : 's'} · ${formatPushedAt(iter.pushedAt)}\n${iter.commits.map((c) => `${c.shortSha} ${c.message}`).join('\n')}`;
        return (
          <button
            key={iter.number}
            role="tab"
            draggable
            onDragStart={(e) => onDragStart(e, iter)}
            onDragOver={(e) => onDragOver(e, iter)}
            onDragLeave={onDragLeave}
            onDrop={(e) => onDrop(e, iter)}
            onDragEnd={onDragEnd}
            className={`iter-tab ${isActive ? 'iter-tab-active' : ''} ${isDragOver ? 'iter-tab-drop-target' : ''}`}
            onClick={() => onSelect({ kind: 'iteration', iteration: iter })}
            title={tooltip}
          >
            <span className="iter-tab-num">#{iter.number}</span>
            <span className="iter-tab-meta">{iter.commitCount}c · {formatPushedAt(iter.pushedAt)}</span>
          </button>
        );
      })}

      {active.kind === 'compare' && (
        <div className="iter-tab iter-tab-compare iter-tab-active" role="tab">
          <span>#{active.from.number} → #{active.to.number}</span>
          <button
            className="iter-tab-close"
            onClick={(e) => {
              e.stopPropagation();
              onSelect(allRange);
            }}
            title="Close compare view"
          >
            ✕
          </button>
        </div>
      )}

      {iterations.length > 0 && active.kind !== 'compare' && (
        <span className="iter-tab-hint">Drag a tab onto another to compare</span>
      )}
    </div>
  );
}
