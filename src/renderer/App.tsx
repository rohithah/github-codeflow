import React, { useState, useEffect, useRef, useCallback } from 'react';
import Login from './components/Login';
import PRSelector from './components/PRSelector';
import FileList from './components/FileList';
import DiffViewer from './components/DiffViewer';
import SearchAcrossFiles from './components/SearchAcrossFiles';

interface PRInfo {
  number: number;
  title: string;
  state: string;
  user: string;
  avatar: string;
  head: string;
  headSha: string;
  base: string;
  additions: number;
  deletions: number;
  changed_files: number;
}

interface FileInfo {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  previous_filename?: string;
}

export default function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [username, setUsername] = useState('');
  const [avatar, setAvatar] = useState('');
  const [loading, setLoading] = useState(true);

  const [owner, setOwner] = useState('');
  const [repo, setRepo] = useState('');
  const [selectedPR, setSelectedPR] = useState<PRInfo | null>(null);
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileInfo | null>(null);
  const [fullPatch, setFullPatch] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [reviewThreads, setReviewThreads] = useState<any[]>([]);
  const [viewMode, setViewMode] = useState<'split' | 'unified'>('split');
  const [pendingComments, setPendingComments] = useState<Array<{ path: string; position: number; body: string; line: number; side: string }>>([]);
  const [showSubmitReview, setShowSubmitReview] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [showFindBar, setShowFindBar] = useState(false);
  const [showSearchPanel, setShowSearchPanel] = useState(false);
  const diffContentRef = useRef<HTMLDivElement>(null);
  const isResizing = useRef(false);

  // Keyboard shortcuts: Ctrl+F = find in file, Ctrl+Shift+F = search across files
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f' && !e.shiftKey) {
        if (selectedPR) {
          e.preventDefault();
          setShowFindBar(true);
          setShowSearchPanel(false);
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'f' && e.shiftKey) {
        if (selectedPR) {
          e.preventDefault();
          setShowSearchPanel((prev) => !prev);
          setShowFindBar(false);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedPR]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isResizing.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isResizing.current) return;
      const newWidth = Math.max(160, Math.min(600, startWidth + ev.clientX - startX));
      setSidebarWidth(newWidth);
    };

    const onMouseUp = () => {
      isResizing.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [sidebarWidth]);

  useEffect(() => {
    window.api.getStoredToken().then((result: any) => {
      if (result.success) {
        setAuthenticated(true);
        setUsername(result.user);
        setAvatar(result.avatar);
      }
      setLoading(false);
    });
  }, []);

  const handleLogin = (user: string, av: string) => {
    setAuthenticated(true);
    setUsername(user);
    setAvatar(av);
  };

  const handleLogout = async () => {
    await window.api.logout();
    setAuthenticated(false);
    setUsername('');
    setAvatar('');
    setSelectedPR(null);
    setFiles([]);
    setSelectedFile(null);
  };

  const handleSelectPR = async (pr: PRInfo, o: string, r: string) => {
    setSelectedPR(pr);
    setOwner(o);
    setRepo(r);
    setSelectedFile(null);
    setFullPatch(null);
    setReviewThreads([]);
    const [filesResult, threadsResult] = await Promise.all([
      window.api.getPRFiles(o, r, pr.number),
      window.api.getReviewThreads(o, r, pr.number),
    ]);
    if (filesResult.success) {
      setFiles(filesResult.files);
      if (filesResult.files.length > 0) {
        selectFileAndFetchDiff(filesResult.files[0], o, r, pr);
      }
    }
    if (threadsResult.success) {
      setReviewThreads(threadsResult.threads);
    }
  };

  const selectFileAndFetchDiff = async (file: FileInfo, o: string, r: string, pr: PRInfo) => {
    setSelectedFile(file);
    setFullPatch(null);
    setDiffLoading(true);
    const result = await window.api.getFullDiff(
      o, r, file.filename, pr.base, pr.head, file.status, file.previous_filename,
    );
    setDiffLoading(false);
    if (result.success) {
      setFullPatch(result.patch);
    }
  };

  const handleSelectFile = (file: FileInfo) => {
    if (selectedPR) {
      selectFileAndFetchDiff(file, owner, repo, selectedPR);
    }
  };

  const refreshThreads = async () => {
    if (selectedPR) {
      const result = await window.api.getReviewThreads(owner, repo, selectedPR.number);
      if (result.success) setReviewThreads(result.threads);
    }
  };

  const addPendingComment = (comment: { path: string; position: number; body: string; line: number; side: string }) => {
    setPendingComments((prev) => [...prev, comment]);
  };

  const handleSubmitReview = async (event: string, body: string) => {
    if (!selectedPR) return { success: false, error: 'No PR selected' };
    const result = await window.api.submitReview(owner, repo, selectedPR.number, event, body);
    if (result.success) {
      setPendingComments([]);
      setShowSubmitReview(false);
      await refreshThreads();
    }
    return result;
  };

  const handleSearchGoToResult = (filename: string, _lineNum: number) => {
    const file = files.find((f) => f.filename === filename);
    if (file && selectedPR) {
      selectFileAndFetchDiff(file, owner, repo, selectedPR);
      setShowSearchPanel(false);
    }
  };

  const handleBack = () => {
    setSelectedPR(null);
    setFiles([]);
    setSelectedFile(null);
    setFullPatch(null);
  };

  if (loading) {
    return (
      <div className="app-loading">
        <div className="spinner" />
        <p>Loading GitHub CodeFlow...</p>
      </div>
    );
  }

  if (!authenticated) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <svg className="logo-icon" viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
          </svg>
          <h1>CodeFlow</h1>
          {selectedPR && (
            <button className="btn btn-ghost" onClick={handleBack}>
              ← Back to PRs
            </button>
          )}
        </div>
        <div className="header-right">
          {selectedPR && (
            <>
              <div className="view-toggle">
                <button className={`btn btn-sm ${viewMode === 'split' ? 'btn-active' : ''}`} onClick={() => setViewMode('split')}>
                  Split
                </button>
                <button className={`btn btn-sm ${viewMode === 'unified' ? 'btn-active' : ''}`} onClick={() => setViewMode('unified')}>
                  Inline
                </button>
              </div>
              <button className="btn btn-sm" onClick={() => { setShowFindBar(!showFindBar); setShowSearchPanel(false); }} title="Find in file (Ctrl+F)">
                🔍
              </button>
              <button className="btn btn-sm" onClick={() => { setShowSearchPanel(!showSearchPanel); setShowFindBar(false); }} title="Search across files (Ctrl+Shift+F)">
                📂🔍
              </button>
              {pendingComments.length > 0 && (
                <button className="btn btn-sm btn-submit-review" onClick={() => setShowSubmitReview(!showSubmitReview)}>
                  ✅ Submit Review ({pendingComments.length})
                </button>
              )}
            </>
          )}
          <div className="user-info">
            {avatar && <img src={avatar} alt={username} className="avatar" />}
            <span>{username}</span>
            <button className="btn btn-ghost btn-sm" onClick={handleLogout}>
              Logout
            </button>
          </div>
        </div>
      </header>

      <div className="app-body">
        {!selectedPR ? (
          <PRSelector onSelectPR={handleSelectPR} />
        ) : (
          <div className="diff-layout">
            {showSearchPanel && (
              <SearchAcrossFiles
                files={files}
                visible={showSearchPanel}
                onClose={() => setShowSearchPanel(false)}
                onGoToResult={handleSearchGoToResult}
              />
            )}
            <FileList
              files={files}
              selectedFile={selectedFile}
              onSelectFile={handleSelectFile}
              pr={selectedPR}
              owner={owner}
              repo={repo}
              width={sidebarWidth}
            />
            <div className="resize-handle" onMouseDown={handleMouseDown} />
            <DiffViewer
              file={selectedFile}
              viewMode={viewMode}
              fullPatch={fullPatch}
              diffLoading={diffLoading}
              reviewThreads={reviewThreads}
              owner={owner}
              repo={repo}
              pr={selectedPR}
              onCommentPosted={refreshThreads}
              onAddPendingComment={addPendingComment}
              pendingComments={pendingComments}
              showFindBar={showFindBar}
              onCloseFindBar={() => setShowFindBar(false)}
            />
          </div>
        )}
      </div>
      {showSubmitReview && (
        <SubmitReviewDialog
          pendingCount={pendingComments.length}
          onSubmit={handleSubmitReview}
          onClose={() => setShowSubmitReview(false)}
        />
      )}
    </div>
  );
}

function SubmitReviewDialog({ pendingCount, onSubmit, onClose }: {
  pendingCount: number;
  onSubmit: (event: string, body: string) => Promise<any>;
  onClose: () => void;
}) {
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: string) => {
    setSubmitting(true);
    setError('');
    const result = await onSubmit(event, body);
    setSubmitting(false);
    if (!result.success) {
      setError(result.error || 'Failed to submit review');
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Submit Review</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <p className="modal-info">{pendingCount} pending comment{pendingCount !== 1 ? 's' : ''}</p>
          <textarea
            placeholder="Leave a review summary (optional)..."
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
          />
          {error && <div className="comment-error">⚠ {error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-sm" onClick={() => handleSubmit('COMMENT')} disabled={submitting}>
            💬 Comment
          </button>
          <button className="btn btn-sm btn-approve" onClick={() => handleSubmit('APPROVE')} disabled={submitting}>
            ✅ Approve
          </button>
          <button className="btn btn-sm btn-request-changes" onClick={() => handleSubmit('REQUEST_CHANGES')} disabled={submitting}>
            🔄 Request Changes
          </button>
        </div>
      </div>
    </div>
  );
}
