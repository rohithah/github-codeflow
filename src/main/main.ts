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
        baseSha: pr.base.sha,
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
        baseSha: pr.base.sha,
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

// Fetch PR commits and group them into "iterations" (push groups).
// Heuristic: consecutive commits whose committer.date timestamps are within
// ITERATION_GAP_MS of each other belong to the same push. Force-pushes show
// up naturally as new iterations because their commits carry fresh timestamps.
ipcMain.handle('github:get-iterations', async (_event, owner: string, repo: string, prNumber: number, prBaseSha: string) => {
  try {
    const ok = ensureOctokit();
    const commits: any[] = [];
    let page = 1;
    while (true) {
      const { data } = await ok.pulls.listCommits({ owner, repo, pull_number: prNumber, per_page: 100, page });
      commits.push(...data);
      if (data.length < 100) break;
      page++;
    }

    const ITERATION_GAP_MS = 60 * 1000;
    const groups: any[][] = [];
    let lastTime = 0;
    for (const c of commits) {
      const dateStr = c.commit.committer?.date || c.commit.author?.date;
      const t = dateStr ? new Date(dateStr).getTime() : 0;
      if (groups.length === 0 || t - lastTime > ITERATION_GAP_MS) {
        groups.push([c]);
      } else {
        groups[groups.length - 1].push(c);
      }
      lastTime = t;
    }

    let prevHead = prBaseSha;
    const iterations = groups.map((group, i) => {
      const head = group[group.length - 1];
      const iter = {
        number: i + 1,
        baseSha: prevHead,
        headSha: head.sha,
        commitCount: group.length,
        pushedAt: head.commit.committer?.date || head.commit.author?.date,
        commits: group.map((c) => ({
          sha: c.sha,
          shortSha: c.sha.substring(0, 7),
          message: c.commit.message.split('\n')[0],
          author: c.commit.author?.name || c.author?.login,
        })),
      };
      prevHead = head.sha;
      return iter;
    });

    return { success: true, iterations };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// Compare two arbitrary refs and return the changed file list.
// Used for iteration tabs and pairwise iteration comparison.
ipcMain.handle('github:compare-refs', async (_event, owner: string, repo: string, baseSha: string, headSha: string) => {
  try {
    const ok = ensureOctokit();
    const { data } = await ok.repos.compareCommitsWithBasehead({
      owner,
      repo,
      basehead: `${baseSha}...${headSha}`,
    });
    return {
      success: true,
      files: (data.files || []).map((f: any) => ({
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

// Fetch raw decoded content of a single file at a given ref (for markdown preview)
ipcMain.handle('github:get-file-content', async (_event, owner: string, repo: string, filePath: string, ref: string) => {
  try {
    const ok = ensureOctokit();
    const { data } = await ok.repos.getContent({ owner, repo, path: filePath, ref }) as any;
    if (data && data.content && data.encoding === 'base64') {
      return { success: true, content: Buffer.from(data.content, 'base64').toString('utf-8') };
    }
    return { success: false, error: 'File is empty or not a text file' };
  } catch (error: any) {
    if (error.status === 404) return { success: false, error: 'File not found at this revision' };
    return { success: false, error: error.message };
  }
});

// Fetch a binary file (image) at a ref and return it as a data URI (for markdown preview)
const IMAGE_MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
};

ipcMain.handle('github:get-file-raw', async (_event, owner: string, repo: string, filePath: string, ref: string) => {
  try {
    const ok = ensureOctokit();
    const { data } = await ok.repos.getContent({ owner, repo, path: filePath, ref }) as any;
    if (data && data.content && data.encoding === 'base64') {
      const ext = (filePath.split('.').pop() || '').toLowerCase();
      const mime = IMAGE_MIME_TYPES[ext] || 'application/octet-stream';
      const base64 = data.content.replace(/\n/g, '');
      return { success: true, dataUri: `data:${mime};base64,${base64}` };
    }
    return { success: false, error: 'Not a file' };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// Fetch review comments (threaded) for a PR
ipcMain.handle('github:get-review-threads', async (_event, owner: string, repo: string, prNumber: number) => {
  try {
    const ok = ensureOctokit();
    const threadList: any[] = [];
    let cursor: string | null = null;
    let hasNextPage = true;

    while (hasNextPage) {
      const result: any = await ok.graphql(`
        query($owner: String!, $repo: String!, $prNumber: Int!, $cursor: String) {
          repository(owner: $owner, name: $repo) {
            pullRequest(number: $prNumber) {
              reviewThreads(first: 100, after: $cursor) {
                nodes {
                  id
                  path
                  line
                  originalLine
                  diffSide
                  isResolved
                  isOutdated
                  resolvedBy { login }
                  comments(first: 100) {
                    nodes {
                      databaseId
                      body
                      createdAt
                      author { login avatarUrl }
                      pullRequestReview { state }
                    }
                  }
                }
                pageInfo { hasNextPage endCursor }
              }
            }
          }
        }
      `, { owner, repo, prNumber, cursor });

      const connection = result.repository.pullRequest.reviewThreads;
      for (const thread of connection.nodes) {
        const comments = thread.comments.nodes.map((comment: any) => ({
          id: comment.databaseId,
          body: comment.body,
          user: comment.author?.login || 'ghost',
          avatar: comment.author?.avatarUrl,
          created_at: comment.createdAt,
          reviewState: comment.pullRequestReview?.state || 'SUBMITTED',
        }));
        const root = comments[0];
        if (!root) continue;
        threadList.push({
          id: root.id,
          nodeId: thread.id,
          path: thread.path,
          line: thread.line || thread.originalLine,
          currentLine: thread.line,
          originalLine: thread.originalLine,
          side: thread.diffSide || 'RIGHT',
          isResolved: thread.isResolved,
          isOutdated: thread.isOutdated,
          resolvedBy: thread.resolvedBy?.login,
          reviewState: root.reviewState,
          comments,
        });
      }

      hasNextPage = connection.pageInfo.hasNextPage;
      cursor = connection.pageInfo.endCursor;
    }

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
        return { success: false, error: 'This line is not part of the diff being viewed.' };
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

      // GitHub returns thread: null (without throwing) when it can't anchor the
      // comment to its diff — e.g. an unchanged line too far from any change.
      const thread = addResult?.addPullRequestReviewThread?.thread;
      const comment = thread?.comments?.nodes?.[0];
      if (!comment) {
        return {
          success: false,
          error: 'GitHub couldn\'t place a comment on this line — it\'s too far from any change in the PR. You can comment on changed lines or unchanged lines near a change.',
        };
      }
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
      let msg = error.message || 'Unknown error';
      // GitHub rejects inline comments on lines that aren't part of its diff
      // (e.g. unchanged lines too far from any change) with a 422.
      if (error.status === 422 || /unprocessable|not part of the diff|must be part of the diff/i.test(msg)) {
        msg = 'GitHub won\'t accept a comment on this line — it\'s too far from any change in the PR. You can comment on changed lines or unchanged lines near a change.';
      }
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
