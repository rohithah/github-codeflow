import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  // Auth
  ghToken: () => ipcRenderer.invoke('auth:gh-token'),
  setToken: (token: string) => ipcRenderer.invoke('auth:set-token', token),
  getStoredToken: () => ipcRenderer.invoke('auth:get-stored-token'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),

  // GitHub
  getRecentRepos: () => ipcRenderer.invoke('store:get-recent-repos'),
  addRecentRepo: (repo: string) => ipcRenderer.invoke('store:add-recent-repo', repo),
  listPRs: (owner: string, repo: string) => ipcRenderer.invoke('github:list-prs', owner, repo),
  getPR: (owner: string, repo: string, prNumber: number) =>
    ipcRenderer.invoke('github:get-pr', owner, repo, prNumber),
  getPRFiles: (owner: string, repo: string, prNumber: number) =>
    ipcRenderer.invoke('github:get-pr-files', owner, repo, prNumber),
  getFullDiff: (owner: string, repo: string, filename: string, baseRef: string, headRef: string, status: string, previousFilename?: string) =>
    ipcRenderer.invoke('github:get-full-diff', owner, repo, filename, baseRef, headRef, status, previousFilename),
  getReviewThreads: (owner: string, repo: string, prNumber: number) =>
    ipcRenderer.invoke('github:get-review-threads', owner, repo, prNumber),
  createReviewComment: (owner: string, repo: string, prNumber: number, body: string, commitId: string, path: string, line: number, side: string, patch: string) =>
    ipcRenderer.invoke('github:add-review-comment', owner, repo, prNumber, body, path, line, side, patch),
  submitReview: (owner: string, repo: string, prNumber: number, event: string, body: string, comments?: any[]) =>
    ipcRenderer.invoke('github:submit-review', owner, repo, prNumber, event, body),
  getPendingReview: (owner: string, repo: string, prNumber: number) =>
    ipcRenderer.invoke('github:get-pending-review', owner, repo, prNumber),
  replyToComment: (owner: string, repo: string, prNumber: number, body: string, commentId: number) =>
    ipcRenderer.invoke('github:reply-to-comment', owner, repo, prNumber, body, commentId),
});
