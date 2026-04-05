import React, { useState, useCallback, useRef } from 'react';

interface FileInfo {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  previous_filename?: string;
}

interface SearchResult {
  filename: string;
  lineNum: number;
  lineContent: string;
  type: 'add' | 'del' | 'context';
}

interface SearchAcrossFilesProps {
  files: FileInfo[];
  visible: boolean;
  onClose: () => void;
  onGoToResult: (filename: string, lineNum: number) => void;
}

function searchInPatch(patch: string, query: string, filename: string): SearchResult[] {
  if (!patch || !query) return [];
  const lowerQuery = query.toLowerCase();
  const lines = patch.split('\n');
  const results: SearchResult[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = parseInt(match[1], 10);
        newLine = parseInt(match[2], 10);
      }
      continue;
    }

    let content: string;
    let type: 'add' | 'del' | 'context';
    let lineNum: number;

    if (line.startsWith('+')) {
      content = line.substring(1);
      type = 'add';
      lineNum = newLine;
      newLine++;
    } else if (line.startsWith('-')) {
      content = line.substring(1);
      type = 'del';
      lineNum = oldLine;
      oldLine++;
    } else {
      content = line.startsWith(' ') ? line.substring(1) : line;
      type = 'context';
      lineNum = newLine;
      oldLine++;
      newLine++;
    }

    if (content.toLowerCase().includes(lowerQuery)) {
      results.push({ filename, lineNum, lineContent: content, type });
    }
  }
  return results;
}

export default function SearchAcrossFiles({ files, visible, onClose, onGoToResult }: SearchAcrossFilesProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const doSearch = useCallback(() => {
    if (!query.trim()) {
      setResults([]);
      setSearched(false);
      return;
    }
    setSearched(true);
    const allResults: SearchResult[] = [];
    for (const file of files) {
      if (file.patch) {
        allResults.push(...searchInPatch(file.patch, query.trim(), file.filename));
      }
    }
    setResults(allResults);
  }, [query, files]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'Enter') doSearch();
  };

  // Group results by file
  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    if (!acc[r.filename]) acc[r.filename] = [];
    acc[r.filename].push(r);
    return acc;
  }, {});

  if (!visible) return null;

  return (
    <div className="search-panel">
      <div className="search-panel-header">
        <span className="search-panel-title">🔍 Search Across Files</span>
        <button className="btn btn-sm btn-ghost" onClick={onClose}>✕</button>
      </div>
      <div className="search-panel-input">
        <input
          ref={inputRef}
          type="text"
          placeholder="Search in all changed files..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
        />
        <button className="btn btn-sm btn-primary" onClick={doSearch} disabled={!query.trim()}>
          Search
        </button>
      </div>
      <div className="search-panel-results">
        {searched && results.length === 0 && (
          <div className="search-no-results">No matches found</div>
        )}
        {Object.entries(grouped).map(([filename, fileResults]) => (
          <div key={filename} className="search-file-group">
            <div className="search-file-name">
              📄 {filename} <span className="search-match-count">({fileResults.length})</span>
            </div>
            {fileResults.slice(0, 50).map((r, i) => (
              <div
                key={i}
                className="search-result-item"
                onClick={() => onGoToResult(r.filename, r.lineNum)}
              >
                <span className="search-line-num">{r.lineNum}</span>
                <span className={`search-line-content ${r.type === 'add' ? 'search-line-add' : r.type === 'del' ? 'search-line-del' : ''}`}>
                  {highlightMatch(r.lineContent, query)}
                </span>
              </div>
            ))}
            {fileResults.length > 50 && (
              <div className="search-more">...and {fileResults.length - 50} more</div>
            )}
          </div>
        ))}
        {searched && results.length > 0 && (
          <div className="search-summary">{results.length} results in {Object.keys(grouped).length} files</div>
        )}
      </div>
    </div>
  );
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const idx = lowerText.indexOf(lowerQuery);
  if (idx === -1) return text;
  return (
    <>
      {text.substring(0, idx)}
      <mark className="search-highlight">{text.substring(idx, idx + query.length)}</mark>
      {text.substring(idx + query.length)}
    </>
  );
}
