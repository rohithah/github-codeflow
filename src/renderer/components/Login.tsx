import React, { useState } from 'react';

interface LoginProps {
  onLogin: (user: string, avatar: string) => void;
}

export default function Login({ onLogin }: LoginProps) {
  const [mode, setMode] = useState<'choice' | 'pat'>('choice');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleGhCli = async () => {
    setLoading(true);
    setError('');
    const result = await window.api.ghToken();
    setLoading(false);
    if (result.success) {
      onLogin(result.user, result.avatar);
    } else {
      setError(result.error);
    }
  };

  const handlePATLogin = async () => {
    if (!token.trim()) return;
    setLoading(true);
    setError('');
    const result = await window.api.setToken(token.trim());
    setLoading(false);
    if (result.success) {
      onLogin(result.user, result.avatar);
    } else {
      setError(result.error || 'Invalid token');
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <svg className="login-logo" viewBox="0 0 24 24" width="64" height="64" fill="currentColor">
          <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
        </svg>
        <h2>GitHub CodeFlow</h2>
        <p className="login-subtitle">Sign in to view PR diffs</p>

        {mode === 'choice' && (
          <div className="login-options">
            <button className="btn btn-primary btn-lg" onClick={handleGhCli} disabled={loading}>
              {loading ? 'Connecting...' : '⚡ Sign in with GitHub CLI'}
            </button>
            <p className="login-hint" style={{ textAlign: 'center' }}>
              Uses your existing <code>gh auth</code> session
            </p>
            <div className="login-divider"><span>or</span></div>
            <button className="btn btn-secondary btn-lg" onClick={() => setMode('pat')}>
              🔑 Use Personal Access Token
            </button>
          </div>
        )}

        {mode === 'pat' && (
          <div className="login-pat">
            <input
              type="password"
              placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handlePATLogin()}
              autoFocus
            />
            <p className="login-hint">
              Generate a token at GitHub → Settings → Developer settings → Personal access tokens.
              <br />Needs <code>repo</code> scope.
            </p>
            <div className="login-actions">
              <button className="btn btn-ghost" onClick={() => { setMode('choice'); setError(''); }}>← Back</button>
              <button className="btn btn-primary" onClick={handlePATLogin} disabled={loading || !token.trim()}>
                {loading ? 'Verifying...' : 'Sign In'}
              </button>
            </div>
          </div>
        )}

        {error && <div className="login-error">⚠ {error}</div>}
      </div>
    </div>
  );
}
