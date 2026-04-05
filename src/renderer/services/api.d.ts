// Type declarations for the preload API bridge
export interface Api {
  ghToken: () => Promise<any>;
  setToken: (token: string) => Promise<any>;
  getStoredToken: () => Promise<any>;
  logout: () => Promise<any>;
  openExternal: (url: string) => Promise<void>;
  getRecentRepos: () => Promise<string[]>;
  addRecentRepo: (repo: string) => Promise<string[]>;
  listPRs: (owner: string, repo: string) => Promise<any>;
  getPR: (owner: string, repo: string, prNumber: number) => Promise<any>;
  getPRFiles: (owner: string, repo: string, prNumber: number) => Promise<any>;
  getFullDiff: (owner: string, repo: string, filename: string, baseRef: string, headRef: string, status: string, previousFilename?: string) => Promise<any>;
  getReviewThreads: (owner: string, repo: string, prNumber: number) => Promise<any>;
  createReviewComment: (owner: string, repo: string, prNumber: number, body: string, commitId: string, path: string, line: number, side: string, patch: string) => Promise<any>;
  submitReview: (owner: string, repo: string, prNumber: number, event: string, body: string, comments?: any[]) => Promise<any>;
  getPendingReview: (owner: string, repo: string, prNumber: number) => Promise<any>;
  replyToComment: (owner: string, repo: string, prNumber: number, body: string, commentId: number) => Promise<any>;
}

declare global {
  interface Window {
    api: Api;
  }
}
