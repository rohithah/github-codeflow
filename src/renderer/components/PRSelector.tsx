import React, { useState, useEffect } from 'react';

interface PRInfo {
  number: number;
  title: string;
  state: string;
  merged: boolean;
  user: string;
  avatar: string;
  created_at: string;
  updated_at: string;
  additions: number;
  deletions: number;
  changed_files: number;
  head: string;
  headSha: string;
  base: string;
}

interface PRSelectorProps {
  onSelectPR: (pr: PRInfo, owner: string, repo: string) => void;
}

export default function PRSelector({ onSelectPR }: PRSelectorProps) {
  const [repoInput, setRepoInput] = useState('');
  const [prs, setPRs] = useState<PRInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);
  const [recentRepos, setRecentRepos] = useState<string[]>([]);
  const [filter, setFilter] = useState<'all' | 'open' | 'closed' | 'merged'>('open');

  useEffect(() => {
    window.api.getRecentRepos().then(setRecentRepos);
  }, []);

  // Parse GitHub PR URL: https://github.com/owner/repo/pull/123
  const parsePRUrl = (input: string): { owner: string; repo: string; pr: number } | null => {
    const urlMatch = input.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (urlMatch) return { owner: urlMatch[1], repo: urlMatch[2], pr: parseInt(urlMatch[3], 10) };
    // Also support owner/repo#123 shorthand
    const shortMatch = input.match(/^([^/]+)\/([^#]+)#(\d+)$/);
    if (shortMatch) return { owner: shortMatch[1], repo: shortMatch[2], pr: parseInt(shortMatch[3], 10) };
    return null;
  };

  const handleSubmit = async (prefill?: string) => {
    const input = (prefill || repoInput).trim();
    if (!input) return;
    if (prefill) setRepoInput(input);

    const prLink = parsePRUrl(input);
    if (prLink) {
      setLoading(true);
      setError('');
      const result = await window.api.getPR(prLink.owner, prLink.repo, prLink.pr);
      setLoading(false);
      if (result.success) {
        const updated = await window.api.addRecentRepo(`${prLink.owner}/${prLink.repo}`);
        setRecentRepos(updated);
        onSelectPR(result.pr, prLink.owner, prLink.repo);
      } else {
        setError(result.error || 'Failed to fetch PR');
      }
      return;
    }

    const parts = input.split('/');
    if (parts.length !== 2) {
      setError('Enter owner/repo, owner/repo#123, or a GitHub PR URL');
      return;
    }
    const [owner, repo] = parts;
    setLoading(true);
    setError('');
    setSearched(true);
    const result = await window.api.listPRs(owner, repo);
    setLoading(false);
    if (result.success) {
      setPRs(result.prs);
      if (result.prs.length === 0) setError('No pull requests found');
      const updated = await window.api.addRecentRepo(`${owner}/${repo}`);
      setRecentRepos(updated);
    } else {
      setError(result.error || 'Failed to fetch PRs');
    }
  };

  const getOwnerRepo = () => {
    const parts = repoInput.trim().split('/');
    return { owner: parts[0], repo: parts[1] };
  };

  const timeAgo = (dateStr: string) => {
    const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 2592000) return `${Math.floor(seconds / 86400)}d ago`;
    return new Date(dateStr).toLocaleDateString();
  };

  return (
    <div className="pr-selector">
      <div className="search-bar">
        <input
          type="text"
          placeholder="PR URL, owner/repo, or owner/repo#123"
          value={repoInput}
          onChange={(e) => setRepoInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          autoFocus
        />
        <button className="btn btn-primary" onClick={() => handleSubmit()} disabled={loading || !repoInput.trim()}>
          {loading ? 'Loading...' : 'Go'}
        </button>
      </div>

      {recentRepos.length > 0 && !searched && prs.length === 0 && (
        <div className="recent-repos">
          <div className="recent-repos-label">Recent</div>
          <div className="recent-repos-list">
            {recentRepos.map((r) => (
              <button key={r} className="btn btn-sm recent-repo-chip" onClick={() => handleSubmit(r)}>
                {r}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && <div className="error-msg">⚠ {error}</div>}

      {prs.length > 0 && (
        <>
          <div className="pr-filters">
            <button className={`btn btn-sm ${filter === 'all' ? 'btn-active' : ''}`} onClick={() => setFilter('all')}>
              All ({prs.length})
            </button>
            <button className={`btn btn-sm ${filter === 'open' ? 'btn-active' : ''}`} onClick={() => setFilter('open')}>
              ● Open ({prs.filter((p) => p.state === 'open').length})
            </button>
            <button className={`btn btn-sm ${filter === 'merged' ? 'btn-active' : ''}`} onClick={() => setFilter('merged')}>
              ⇌ Merged ({prs.filter((p) => p.merged).length})
            </button>
            <button className={`btn btn-sm ${filter === 'closed' ? 'btn-active' : ''}`} onClick={() => setFilter('closed')}>
              ✕ Closed ({prs.filter((p) => p.state === 'closed' && !p.merged).length})
            </button>
          </div>
          <div className="pr-list">
            {prs
              .filter((pr) => {
                if (filter === 'open') return pr.state === 'open';
                if (filter === 'merged') return pr.merged;
                if (filter === 'closed') return pr.state === 'closed' && !pr.merged;
                return true;
              })
              .map((pr) => (
              <div key={pr.number} className="pr-item" onClick={() => { const { owner, repo } = getOwnerRepo(); onSelectPR(pr, owner, repo); }}>
                <div className="pr-item-left">
                  <span className={`pr-state ${pr.merged ? 'pr-state-merged' : pr.state === 'open' ? 'pr-state-open' : 'pr-state-closed'}`}>
                    {pr.merged ? '⇌' : pr.state === 'open' ? '●' : '✕'}
                  </span>
                  <div className="pr-info">
                    <div className="pr-title">
                      {pr.title}
                      <span className="pr-number">#{pr.number}</span>
                    </div>
                    <div className="pr-meta">
                      {pr.user} • {pr.base} ← {pr.head} • updated {timeAgo(pr.updated_at)}
                    </div>
                  </div>
                </div>
                <div className="pr-item-right">
                  <span className="stat-add">+{pr.additions}</span>
                  <span className="stat-del">-{pr.deletions}</span>
                  <span className="stat-files">{pr.changed_files} files</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {searched && !loading && prs.length === 0 && !error && (
        <div className="empty-state">No pull requests found for this repository.</div>
      )}
    </div>
  );
}
