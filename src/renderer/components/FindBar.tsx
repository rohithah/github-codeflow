import React, { useState, useEffect, useCallback, useRef } from 'react';

interface FindBarProps {
  visible: boolean;
  onClose: () => void;
  contentRef: React.RefObject<HTMLDivElement | null>;
}

export default function FindBar({ visible, onClose, contentRef }: FindBarProps) {
  const [query, setQuery] = useState('');
  const [matchIndex, setMatchIndex] = useState(0);
  const [matchCount, setMatchCount] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const highlightsRef = useRef<HTMLElement[]>([]);

  const clearHighlights = useCallback(() => {
    for (const el of highlightsRef.current) {
      const parent = el.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(el.textContent || ''), el);
        parent.normalize();
      }
    }
    highlightsRef.current = [];
  }, []);

  const doSearch = useCallback((searchQuery: string) => {
    clearHighlights();
    if (!searchQuery || !contentRef.current) {
      setMatchCount(0);
      setMatchIndex(0);
      return;
    }

    const lowerQuery = searchQuery.toLowerCase();
    const walker = document.createTreeWalker(
      contentRef.current,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (parent.closest('.find-bar') || parent.closest('.diff-gutter') || parent.closest('.diff-marker')) {
            return NodeFilter.FILTER_REJECT;
          }
          if (parent.tagName === 'PRE' || parent.closest('pre') || parent.closest('.diff-code')) {
            return NodeFilter.FILTER_ACCEPT;
          }
          return NodeFilter.FILTER_REJECT;
        },
      },
    );

    const textNodes: Text[] = [];
    let node;
    while ((node = walker.nextNode())) {
      textNodes.push(node as Text);
    }

    const marks: HTMLElement[] = [];
    for (const textNode of textNodes) {
      const text = textNode.textContent || '';
      const lowerText = text.toLowerCase();
      let startIdx = 0;
      const indices: number[] = [];
      while (true) {
        const idx = lowerText.indexOf(lowerQuery, startIdx);
        if (idx === -1) break;
        indices.push(idx);
        startIdx = idx + 1;
      }
      if (indices.length === 0) continue;

      // Split text node and wrap matches
      const parent = textNode.parentNode!;
      const frag = document.createDocumentFragment();
      let lastEnd = 0;
      for (const idx of indices) {
        if (idx > lastEnd) {
          frag.appendChild(document.createTextNode(text.substring(lastEnd, idx)));
        }
        const mark = document.createElement('mark');
        mark.className = 'search-highlight';
        mark.textContent = text.substring(idx, idx + searchQuery.length);
        frag.appendChild(mark);
        marks.push(mark);
        lastEnd = idx + searchQuery.length;
      }
      if (lastEnd < text.length) {
        frag.appendChild(document.createTextNode(text.substring(lastEnd)));
      }
      parent.replaceChild(frag, textNode);
    }

    highlightsRef.current = marks;
    setMatchCount(marks.length);
    if (marks.length > 0) {
      setMatchIndex(0);
      marks[0].classList.add('search-highlight-active');
      marks[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [contentRef, clearHighlights]);

  const goToMatch = useCallback((idx: number) => {
    const marks = highlightsRef.current;
    if (marks.length === 0) return;
    const wrapped = ((idx % marks.length) + marks.length) % marks.length;
    marks.forEach((m) => m.classList.remove('search-highlight-active'));
    marks[wrapped].classList.add('search-highlight-active');
    marks[wrapped].scrollIntoView({ behavior: 'smooth', block: 'center' });
    setMatchIndex(wrapped);
  }, []);

  useEffect(() => {
    if (visible && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
    if (!visible) {
      clearHighlights();
      setQuery('');
      setMatchCount(0);
      setMatchIndex(0);
    }
  }, [visible, clearHighlights]);

  useEffect(() => {
    const timer = setTimeout(() => doSearch(query), 150);
    return () => clearTimeout(timer);
  }, [query, doSearch]);

  // Clean up highlights on unmount
  useEffect(() => () => clearHighlights(), [clearHighlights]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'Enter') {
      if (e.shiftKey) goToMatch(matchIndex - 1);
      else goToMatch(matchIndex + 1);
    }
  };

  if (!visible) return null;

  return (
    <div className="find-bar">
      <input
        ref={inputRef}
        type="text"
        className="find-input"
        placeholder="Find in file..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <span className="find-count">
        {query ? `${matchCount > 0 ? matchIndex + 1 : 0} / ${matchCount}` : ''}
      </span>
      <button className="btn btn-sm btn-nav" onClick={() => goToMatch(matchIndex - 1)} disabled={matchCount === 0} title="Previous (Shift+Enter)">
        ▲
      </button>
      <button className="btn btn-sm btn-nav" onClick={() => goToMatch(matchIndex + 1)} disabled={matchCount === 0} title="Next (Enter)">
        ▼
      </button>
      <button className="btn btn-sm btn-ghost" onClick={onClose} title="Close (Esc)">
        ✕
      </button>
    </div>
  );
}
