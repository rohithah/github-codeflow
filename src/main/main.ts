import { app, BrowserWindow, ipcMain, shell } from 'electron';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { Octokit } from '@octokit/rest';
import Store from 'electron-store';
import { createTwoFilesPatch } from 'diff';

const execFileAsync = promisify(execFile);
const store = new Store();
let mainWindow: BrowserWindow | null = null;
let octokit: Octokit | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'GitHub CodeFlow',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

// --- Auth ---

async function initOctokit(token: string) {
  octokit = new Octokit({ auth: token });
  const { data } = await octokit.users.getAuthenticated();
  store.set('github_token', token);
  return { success: true, user: data.login, avatar: data.avatar_url };
}

// Try to grab token from gh CLI
ipcMain.handle('auth:gh-token', async () => {
  try {
    const { stdout } = await execFileAsync('gh', ['auth', 'token'], { timeout: 5000 });
    const token = stdout.trim();
    if (!token) return { success: false, error: 'gh CLI returned empty token' };
    return await initOctokit(token);
  } catch (error: any) {
    // gh not installed or not logged in
    const msg = error.code === 'ENOENT'
      ? 'gh CLI not found. Install it from https://cli.github.com'
      : error.stderr?.includes('not logged')
        ? 'Not logged in to gh CLI. Run: gh auth login'
        : error.message;
    return { success: false, error: msg };
  }
});

// Manual PAT entry
ipcMain.handle('auth:set-token', async (_event, token: string) => {
  try {
    return await initOctokit(token);
  } catch (error: any) {
    octokit = null;
    return { success: false, error: error.message };
  }
});

// Restore saved token on app start
ipcMain.handle('auth:get-stored-token', async () => {
  const token = store.get('github_token') as string | undefined;
  if (token) {
    try {
      return await initOctokit(token);
    } catch {
      store.delete('github_token');
      octokit = null;
    }
  }
  return { success: false };
});

ipcMain.handle('auth:logout', async () => {
  store.delete('github_token');
  octokit = null;
  return { success: true };
});

ipcMain.handle('shell:open-external', async (_event, url: string) => {
  if (url) shell.openExternal(url);
});

// --- Recent Repos ---

ipcMain.handle('store:get-recent-repos', async () => {
  return (store.get('recent_repos') as string[]) || [];
});

ipcMain.handle('store:add-recent-repo', async (_event, repo: string) => {
  const recent = ((store.get('recent_repos') as string[]) || []).filter((r) => r !== repo);
  recent.unshift(repo);
  store.set('recent_repos', recent.slice(0, 10));
  return recent.slice(0, 10);
});

// --- GitHub API ---

function ensureOctokit() {
  if (!octokit) throw new Error('Not authenticated');
  return octokit;
}

ipcMain.handle('github:list-prs', async (_event, owner: string, repo: string) => {
  try {
    const ok = ensureOctokit();
    const { data } = await ok.pulls.list({ owner, repo, state: 'all', per_page: 50, sort: 'updated', direction: 'desc' });
    return {
      success: true,
      prs: data.map((pr: any) => ({
        number: pr.number,
        title: pr.title,
        state: pr.state,
        merged: !!pr.merged_at,
        user: pr.user?.login,
        avatar: pr.user?.avatar_url,
        created_at: pr.created_at,
        updated_at: pr.updated_at,
        additions: pr.additions ?? 0,
        deletions: pr.deletions ?? 0,
        changed_files: pr.changed_files ?? 0,
        head: pr.head.ref,
        headSha: pr.head.sha,
        base: pr.base.ref,
      })),
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('github:get-pr', async (_event, owner: string, repo: string, prNumber: number) => {
  try {
    const ok = ensureOctokit();
    const { data: pr } = await ok.pulls.get({ owner, repo, pull_number: prNumber });
    return {
      success: true,
      pr: {
        number: pr.number,
        title: pr.title,
        state: pr.state,
        user: pr.user?.login,
        avatar: pr.user?.avatar_url,
        created_at: pr.created_at,
        updated_at: pr.updated_at,
        additions: pr.additions ?? 0,
        deletions: pr.deletions ?? 0,
        changed_files: pr.changed_files ?? 0,
        head: pr.head.ref,
        headSha: pr.head.sha,
        base: pr.base.ref,
      },
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('github:get-pr-files',async (_event, owner: string, repo: string, prNumber: number) => {
  try {
    const ok = ensureOctokit();
    const files: any[] = [];
    let page = 1;
    while (true) {
      const { data } = await ok.pulls.listFiles({ owner, repo, pull_number: prNumber, per_page: 100, page });
      files.push(...data);
      if (data.length < 100) break;
      page++;
    }
    return {
      success: true,
      files: files.map((f) => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        changes: f.changes,
        patch: f.patch,
        previous_filename: f.previous_filename,
      })),
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle(
  'github:get-full-diff',
  async (_event, owner: string, repo: string, filename: string, baseRef: string, headRef: string, status: string, previousFilename?: string) => {
    try {
      const ok = ensureOctokit();

      async function fetchContent(ref: string, filePath: string): Promise<string> {
        try {
          const { data } = await ok.repos.getContent({ owner, repo, path: filePath, ref }) as any;
          if (data.content && data.encoding === 'base64') {
            return Buffer.from(data.content, 'base64').toString('utf-8');
          }
          return '';
        } catch (e: any) {
          if (e.status === 404) return '';
          throw e;
        }
      }

      let oldContent = '';
      let newContent = '';

      if (status === 'added') {
        newContent = await fetchContent(headRef, filename);
      } else if (status === 'removed') {
        oldContent = await fetchContent(baseRef, filename);
      } else if (status === 'renamed' && previousFilename) {
        [oldContent, newContent] = await Promise.all([
          fetchContent(baseRef, previousFilename),
          fetchContent(headRef, filename),
        ]);
      } else {
        [oldContent, newContent] = await Promise.all([
          fetchContent(baseRef, filename),
          fetchContent(headRef, filename),
        ]);
      }

      const patch = createTwoFilesPatch(
        previousFilename || filename,
        filename,
        oldContent,
        newContent,
        '',
        '',
        { context: 99999 },
      );

      // Strip header lines, keep from first @@ hunk onward
      const lines = patch.split('\n');
      let startIdx = 0;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('@@')) {
          startIdx = i;
          break;
        }
      }
      const fullPatch = lines.slice(startIdx).join('\n');

      return { success: true, patch: fullPatch };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
);

// Fetch review comments (threaded) for a PR
ipcMain.handle('github:get-review-threads', async (_event, owner: string, repo: string, prNumber: number) => {
  try {
    const ok = ensureOctokit();
    const comments: any[] = [];
    let page = 1;
    while (true) {
      const { data } = await ok.pulls.listReviewComments({ owner, repo, pull_number: prNumber, per_page: 100, page });
      comments.push(...data);
      if (data.length < 100) break;
      page++;
    }

    // Group into threads by in_reply_to_id
    const threads: Record<number, any[]> = {};
    for (const c of comments) {
      const rootId = c.in_reply_to_id || c.id;
      if (!threads[rootId]) threads[rootId] = [];
      threads[rootId].push({
        id: c.id,
        body: c.body,
        user: c.user?.login,
        avatar: c.user?.avatar_url,
        created_at: c.created_at,
        path: c.path,
        line: c.line || c.original_line,
        side: c.side,
        in_reply_to_id: c.in_reply_to_id,
      });
    }

    // Build thread list with root comment info
    const threadList = Object.values(threads).map((msgs) => {
      msgs.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      const root = msgs[0];
      return {
        id: root.id,
        path: root.path,
        line: root.line,
        side: root.side,
        comments: msgs,
      };
    });

    console.log('[get-review-threads]', threadList.length, 'threads found');
    return { success: true, threads: threadList };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// Add a comment to the user's pending review (creates one if needed).
// Uses GraphQL which reliably finds pending reviews.
ipcMain.handle(
  'github:add-review-comment',
  async (_event, owner: string, repo: string, prNumber: number, body: string, filePath: string, line: number, side: string, patch: string) => {
    try {
      const ok = ensureOctokit();
      const position = computePosition(patch, line, side);
      if (position === null) {
        return { success: false, error: 'This line is not part of the PR diff. Try commenting on a changed line.' };
      }

      // Find existing pending review via GraphQL
      const gqlResult: any = await ok.graphql(`
        query($owner: String!, $repo: String!, $prNumber: Int!) {
          repository(owner: $owner, name: $repo) {
            pullRequest(number: $prNumber) {
              id
              reviews(states: PENDING, first: 1) {
                nodes { id, databaseId }
              }
            }
          }
        }
      `, { owner, repo, prNumber });

      const pr = gqlResult.repository.pullRequest;
      let reviewId = pr.reviews.nodes[0]?.id;

      if (!reviewId) {
        // Create a pending review via GraphQL
        const createResult: any = await ok.graphql(`
          mutation($prId: ID!) {
            addPullRequestReview(input: { pullRequestId: $prId }) {
              pullRequestReview { id }
            }
          }
        `, { prId: pr.id });
        reviewId = createResult.addPullRequestReview.pullRequestReview.id;
      }

      // Add comment thread to the pending review
      const addResult: any = await ok.graphql(`
        mutation($reviewId: ID!, $body: String!, $path: String!, $line: Int!, $side: DiffSide!) {
          addPullRequestReviewThread(input: {
            pullRequestReviewId: $reviewId,
            body: $body,
            path: $path,
            line: $line,
            side: $side
          }) {
            thread {
              id
              comments(first: 1) {
                nodes { id, body, author { login, avatarUrl }, createdAt }
              }
            }
          }
        }
      `, { reviewId, body, path: filePath, line, side: side === 'LEFT' ? 'LEFT' : 'RIGHT' });

      const comment = addResult.addPullRequestReviewThread.thread.comments.nodes[0];
      return {
        success: true,
        comment: {
          id: comment.id,
          body: comment.body,
          user: comment.author?.login,
          avatar: comment.author?.avatarUrl,
          created_at: comment.createdAt,
          path: filePath,
          line,
          side,
        },
      };
    } catch (error: any) {
      const msg = error.message || 'Unknown error';
      return { success: false, error: msg };
    }
  },
);

// Submit the user's pending review
ipcMain.handle(
  'github:submit-review',
  async (_event, owner: string, repo: string, prNumber: number, reviewEvent: string, reviewBody: string) => {
    try {
      const ok = ensureOctokit();

      // Find pending review via GraphQL
      const gqlResult: any = await ok.graphql(`
        query($owner: String!, $repo: String!, $prNumber: Int!) {
          repository(owner: $owner, name: $repo) {
            pullRequest(number: $prNumber) {
              reviews(states: PENDING, first: 1) {
                nodes { id }
              }
            }
          }
        }
      `, { owner, repo, prNumber });

      const reviewNodeId = gqlResult.repository.pullRequest.reviews.nodes[0]?.id;
      if (!reviewNodeId) {
        return { success: false, error: 'No pending review to submit.' };
      }

      const eventMap: Record<string, string> = {
        COMMENT: 'COMMENT',
        APPROVE: 'APPROVE',
        REQUEST_CHANGES: 'REQUEST_CHANGES',
      };

      await ok.graphql(`
        mutation($reviewId: ID!, $event: PullRequestReviewEvent!, $body: String) {
          submitPullRequestReview(input: {
            pullRequestReviewId: $reviewId,
            event: $event,
            body: $body
          }) {
            pullRequestReview { id }
          }
        }
      `, { reviewId: reviewNodeId, event: eventMap[reviewEvent] || 'COMMENT', body: reviewBody || '' });

      return { success: true };
    } catch (error: any) {
      const msg = error.message || 'Unknown error';
      return { success: false, error: msg };
    }
  },
);

// Get pending review comment count via GraphQL
ipcMain.handle(
  'github:get-pending-review',
  async (_event, owner: string, repo: string, prNumber: number) => {
    try {
      const ok = ensureOctokit();
      const gqlResult: any = await ok.graphql(`
        query($owner: String!, $repo: String!, $prNumber: Int!) {
          repository(owner: $owner, name: $repo) {
            pullRequest(number: $prNumber) {
              reviews(states: PENDING, first: 1) {
                nodes {
                  id
                  comments(first: 0) { totalCount }
                }
              }
            }
          }
        }
      `, { owner, repo, prNumber });

      const node = gqlResult.repository.pullRequest.reviews.nodes[0];
      if (!node) return { success: true, pending: false, count: 0 };
      return { success: true, pending: true, count: node.comments.totalCount };
    } catch {
      return { success: true, pending: false, count: 0 };
    }
  },
);

// Walk a GitHub patch to find the 1-based position for a given file line + side
function computePosition(patch: string | undefined, targetLine: number, side: string): number | null {
  if (!patch) return null;
  const lines = patch.split('\n');
  let pos = 0;
  let oldLine = 0;
  let newLine = 0;

  for (const raw of lines) {
    if (raw.startsWith('@@')) {
      const m = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m) {
        oldLine = parseInt(m[1], 10);
        newLine = parseInt(m[2], 10);
      }
      pos++;
      continue;
    }

    pos++;

    if (raw.startsWith('+')) {
      // Added line — only visible on RIGHT side
      if (side === 'RIGHT' && newLine === targetLine) return pos;
      newLine++;
    } else if (raw.startsWith('-')) {
      // Deleted line — only visible on LEFT side
      if (side === 'LEFT' && oldLine === targetLine) return pos;
      oldLine++;
    } else {
      // Context line — visible on both sides
      if (side === 'RIGHT' && newLine === targetLine) return pos;
      if (side === 'LEFT' && oldLine === targetLine) return pos;
      oldLine++;
      newLine++;
    }
  }
  return null;
}

// Reply to an existing review comment thread
ipcMain.handle(
  'github:reply-to-comment',
  async (_event, owner: string, repo: string, prNumber: number, body: string, commentId: number) => {
    try {
      const ok = ensureOctokit();
      const { data } = await ok.pulls.createReplyForReviewComment({
        owner,
        repo,
        pull_number: prNumber,
        body,
        comment_id: commentId,
      });
      return {
        success: true,
        comment: {
          id: data.id,
          body: data.body,
          user: data.user?.login,
          avatar: data.user?.avatar_url,
          created_at: data.created_at,
        },
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
);
