# GitHub CodeFlow — Design Document

This document describes the architecture of GitHub CodeFlow so that contributors
have a single place to orient themselves before making changes. It complements
the user-facing [README.md](./README.md), which focuses on features and install
instructions.

---

## 1. Goals & Non-Goals

### Goals
- Provide a desktop PR review experience that goes beyond what github.com offers:
  - **Full-file** diffs (not just changed hunks) with surrounding context.
  - Collapsible directory **tree sidebar** for changed files.
  - **Pending/draft reviews** that accumulate locally and are submitted in one batch.
  - Fast in-file and cross-file **search**.
  - **Quick navigation** via URL paste, `owner/repo#n` shorthand, and recent repos.
- Authenticate via the user's existing `gh` CLI session when available, with a
  Personal Access Token (PAT) fallback.
- Stay a thin, self-contained client — no backend, no telemetry, no server-side
  state.

### Non-Goals
- Not a general Git client (no clone/commit/push).
- Not a full GitHub client (no issues, Actions, projects, etc.).
- No multi-account support — exactly one authenticated identity at a time.
- No offline mode. All data is fetched live from the GitHub API.

---

## 2. High-Level Architecture

GitHub CodeFlow is a standard Electron app with three logical processes:

```
┌──────────────────────────┐        IPC          ┌────────────────────────┐
│  Renderer (Chromium)     │  ◄──────────────►   │  Main (Node.js)        │
│  React 18 + TypeScript   │   contextBridge     │  Octokit + electron-   │
│  src/renderer/**         │   ──► Preload ──►   │  store + gh CLI shell  │
│                          │                     │  src/main/main.ts      │
└──────────────────────────┘                     └─────────────┬──────────┘
            ▲                                                  │
            │                                                  │  HTTPS
            │                                                  ▼
            │                                       ┌────────────────────┐
            └─── only via window.api (preload) ──── │  GitHub REST +     │
                                                    │  GraphQL APIs      │
                                                    └────────────────────┘
```

Key boundary rules:

- **Renderer never touches Node/Electron APIs directly.**
  `contextIsolation: true`, `nodeIntegration: false` (see `src/main/main.ts`).
- **All GitHub I/O happens in the main process** so the auth token never leaves
  Node-land. The renderer only sees plain, serializable result objects.
- **The preload script is the sole bridge.** Every renderer→main capability
  goes through `window.api.*`, defined in `src/preload/preload.ts` and typed in
  `src/renderer/services/api.d.ts`.

---

## 3. Source Layout

```
src/
├── main/main.ts              # Electron main process: window, IPC, GitHub API
├── preload/preload.ts        # contextBridge → window.api
└── renderer/
    ├── index.html, index.tsx # Renderer entry
    ├── App.tsx               # Top-level state, routing between views
    ├── components/
    │   ├── Login.tsx              # gh CLI / PAT sign-in
    │   ├── PRSelector.tsx         # Repo entry, recent repos, PR list
    │   ├── FileList.tsx           # Collapsible file tree sidebar
    │   ├── DiffViewer.tsx         # Full-file diff renderer (core)
    │   ├── FindBar.tsx            # Ctrl+F find-in-file
    │   ├── SearchAcrossFiles.tsx  # Ctrl+Shift+F cross-file search
    │   └── CommentsNavigator.tsx  # Filterable review-thread navigator
    ├── services/api.d.ts     # Types for window.api
    └── styles/app.css        # All styling

dist/                          # Webpack output, three sub-bundles
webpack.config.js              # Builds main, preload, renderer
package.json                   # Scripts + electron-builder config
```

---

## 4. Process Responsibilities

### 4.1 Main Process — `src/main/main.ts`

Responsibilities:

1. **Window lifecycle.** Creates a single `BrowserWindow` (1400×900, min 900×600).
2. **Authentication state.** Holds a module-level `octokit: Octokit | null`
   and persists the token in `electron-store` under key `github_token`.
3. **IPC handlers** (all registered with `ipcMain.handle`):

   | Channel                          | Purpose                                         |
   |----------------------------------|-------------------------------------------------|
   | `auth:gh-token`                  | Shell out to `gh auth token`, init Octokit     |
   | `auth:set-token`                 | Init Octokit from a PAT                         |
   | `auth:get-stored-token`          | Restore previously saved token on launch        |
   | `auth:logout`                    | Clear token + Octokit                           |
   | `shell:open-external`            | Open URL in default browser                     |
   | `store:get-recent-repos`         | Read `recent_repos` list (max 10)               |
   | `store:add-recent-repo`          | Prepend a repo, dedupe, cap at 10               |
   | `github:list-prs`                | `pulls.list` for a repo                         |
   | `github:get-pr`                  | `pulls.get` for one PR                          |
   | `github:get-pr-files`            | Paginated `pulls.listFiles`                     |
   | `github:get-full-diff`           | Fetch both file versions, regenerate full patch |
   | `github:get-review-threads`      | List + group review comments into threads       |
   | `github:add-review-comment`      | Add comment to pending review (GraphQL)         |
   | `github:get-pending-review`      | Count of comments in pending review             |
   | `github:submit-review`           | Submit pending review (COMMENT/APPROVE/REQUEST_CHANGES) |
   | `github:reply-to-comment`        | Reply to an existing review comment             |

4. **Storage**, via `electron-store`:
   - `github_token` — string. The active OAuth or PAT token.
   - `recent_repos` — string[] of `owner/repo`, most-recent first, capped at 10.

### 4.2 Preload — `src/preload/preload.ts`

A thin, declarative mapping. Each method on `window.api` calls
`ipcRenderer.invoke(channel, ...args)` and returns the result.

- All exposed methods are async (Promise-returning).
- Result shapes are not validated here — the renderer trusts the main process.
- The type contract is in `src/renderer/services/api.d.ts`. **Keep these two
  files in sync** when adding capabilities.

### 4.3 Renderer — `src/renderer/`

A single-page React app with a small, hand-rolled state machine in `App.tsx`.

States (mutually exclusive top-level screens):
1. **Loading** — restoring stored token.
2. **Login** (`<Login />`) — no auth.
3. **PR list** (`<PRSelector />`) — authenticated, no PR selected.
4. **PR detail** — file tree + diff viewer.

#### `App.tsx`

Owns nearly all session state:

| State                          | Owned by App? | Notes                                 |
|--------------------------------|----------------|---------------------------------------|
| `authenticated`, `username`, `avatar` | ✅       | Set on login, cleared on logout       |
| `owner`, `repo`, `selectedPR`  | ✅             | The current PR context                |
| `files`, `selectedFile`        | ✅             | Loaded after selecting a PR           |
| `fullPatch`, `diffLoading`     | ✅             | Refetched per-file                    |
| `reviewThreads`                | ✅             | Refreshed after every comment action  |
| `viewMode` (`split` \| `unified`) | ✅          | Toggle in header                      |
| `pendingComments`              | ✅             | Drafts; flushed on submit             |
| `sidebarWidth`                 | ✅             | Mouse-drag resize                     |
| `showFindBar`, `showSearchPanel`, `showSubmitReview` | ✅ | UI toggles  |

Keyboard shortcuts:
- `Ctrl/Cmd + F` → toggle in-file find.
- `Ctrl/Cmd + Shift + F` → toggle cross-file search.

#### `components/PRSelector.tsx`
- Repo entry: accepts raw `owner/repo`, full PR URL
  (`https://github.com/owner/repo/pull/123`), or shorthand (`owner/repo#123`).
- Lists PRs with state filter (Open / Merged / Closed).
- Surfaces recent repos as chips, read from main via `getRecentRepos()`.

#### `components/FileList.tsx`
- Builds a directory tree from the flat list of `{filename, status, additions, deletions}`.
- Auto-collapses chains of single-child folders into one node (e.g.
  `src/main/components` → one row instead of three).
- Renders a status badge (A/M/D/R) and `+N/−M` per file.

#### `components/DiffViewer.tsx` (largest component, ~600 lines)
- Renders a unified patch in **split** or **inline** layout.
- Parses `@@` hunk headers to map diff positions to old/new line numbers.
- Deleted-line strikethrough, added-line highlight, gutter change markers.
- ▲/▼ buttons jump between changed regions in the current file.
- Right-click on a line → "Add comment" prompt → `pendingComments` (drafts).
- Renders existing `reviewThreads` inline at the correct (path, line, side).
- Hosts `<FindBar />` overlay when `showFindBar` is true.

#### `components/FindBar.tsx`
In-file find with highlight + prev/next, scoped to the currently rendered diff.

#### `components/SearchAcrossFiles.tsx`
Scans `files[].patch` (the GitHub-provided changed-hunk patch) for matches across
all files in the PR, grouped by file. Note this is **not** a full-file search;
it only searches within changed hunks because that is what `pulls.listFiles`
returns. Results are shown in a floating overlay over the review workspace.
Selecting a result navigates to its file without dismissing the overlay and
highlights the active result, allowing rapid traversal. The panel closes only
through its close button, Escape, or the cross-file search toggle.

---

## 5. Key Data Flows

### 5.1 Authentication
```
Login.tsx ──► window.api.ghToken()  ──► main: execFile('gh', ['auth', 'token'])
                                       ──► new Octokit({ auth })
                                       ──► users.getAuthenticated()
                                       ──► store.set('github_token')
            ◄── { success, user, avatar }
```
On next launch, `App.tsx` calls `getStoredToken()` to silently re-auth. PAT entry
follows the same path via `auth:set-token` and skips the `gh` shell-out.

### 5.2 Opening a PR
```
PRSelector ──► getPRFiles + getReviewThreads (parallel)
            ◄─ files[], threads[]
App.tsx auto-selects files[0] ──► getFullDiff(owner, repo, filename, baseSha, headSha, status, previousFilename)
```
`getFullDiff` runs in main:
1. Fetch base and head file contents via `repos.getContent` (base64-decoded).
2. Generate a unified patch with `diff.createTwoFilesPatch(..., { context: 99999 })`
   so every line of the file appears in the patch.
3. Strip the header lines; return everything from the first `@@` onward.

Renamed/added/deleted files are handled with branches that fetch only the
relevant side.

### 5.3 Adding a Pending Review Comment
```
User right-clicks a line → DiffViewer prompts for body
   ──► window.api.createReviewComment(...)
       ──► main: GraphQL query for existing PENDING review
       ──► if missing: addPullRequestReview mutation
       ──► addPullRequestReviewThread mutation
   ◄── { success, comment }
App.tsx adds to pendingComments
```
The renderer also computes a local `pendingComments` array for the header badge.
The authoritative state lives on GitHub as a pending review; the renderer
re-reads it via `getPendingReview()` and `getReviewThreads()` after submission.

Internally, `computePosition(patch, line, side)` walks the unified diff to
translate (file line, side) into a 1-based diff position. Currently this is
used as a **validation gate** ("is this line actually in the diff?") — the
GraphQL mutation itself takes `(path, line, side)` directly, not position.

The patch passed to this gate is the **full-file diff** that the viewer renders
(`fullPatch`, generated with `context: 99999`), *not* the truncated changed-hunk
`file.patch` from `pulls.listFiles`. This lets reviewers comment on **unchanged
lines**, not just changed hunks. GitHub remains the final authority: it returns
`422` for lines too far from any change, which the handler catches and surfaces
as a friendly message.

### 5.4 Submitting the Review
```
SubmitReviewDialog ──► submitReview(event, body)
                       ──► main: find PENDING review id (GraphQL)
                       ──► submitPullRequestReview mutation with event ∈
                           {COMMENT, APPROVE, REQUEST_CHANGES}
```
On success, `App.tsx` clears `pendingComments` and refreshes threads.

---

## 6. Build & Packaging

### Webpack (`webpack.config.js`)
Three entry points compiled with `ts-loader`:
- `src/main/main.ts` → `dist/main/main.js` (target: `electron-main`)
- `src/preload/preload.ts` → `dist/preload/preload.js` (target: `electron-preload`)
- `src/renderer/index.tsx` → `dist/renderer/renderer.js` (target: `web`)

`copy-webpack-plugin` copies `index.html` and `app.css`; `html-webpack-plugin`
wires the script tag.

### Scripts
| Script           | Effect                                              |
|------------------|-----------------------------------------------------|
| `npm run build`  | Webpack production build into `dist/`               |
| `npm start`      | Build + launch Electron pointed at `dist/main/main.js` |
| `npm run dev`    | Build in development mode + launch                  |
| `npm run pack`   | `electron-builder --dir` (unpacked output)          |
| `npm run dist`   | Full installers for current platform                |
| `dist:win/mac/linux` | Platform-specific installer builds              |

### `electron-builder` (in `package.json` `build`)
- App ID: `com.rohithah.github-codeflow`
- Targets:
  - **Windows**: `nsis` installer + `portable` exe
  - **macOS**: `dmg` (developer-tools category)
  - **Linux**: `AppImage` + `deb` (Development category)
- Publishes to GitHub Releases (`provider: github`, `owner: rohithah`).

---

## 7. Conventions & Patterns

- **TypeScript everywhere.** Renderer, preload, and main all share the same
  `tsconfig.json` style.
- **Pure-function React.** All components are function components with hooks;
  no class components or external state library.
- **Single-direction IPC.** Renderer invokes, main responds. There are
  currently no `webContents.send` push channels from main → renderer.
- **Result shape.** Most IPC handlers return either
  `{ success: true, ...data }` or `{ success: false, error: string }`.
  Renderer code branches on `result.success`.
- **Errors.** Caught at the IPC boundary and surfaced as `error` strings — they
  do not propagate as thrown exceptions into the renderer.
- **Pagination.** REST endpoints with potentially long results
  (`pulls.listFiles`, `pulls.listReviewComments`) iterate with `per_page: 100`
  until a short page is returned.

---

## 8. Known Limitations & Sharp Edges

These are good to know before making changes — none are bugs per se, but they
shape what features are easy vs. hard.

1. **Single global Octokit.** No multi-account or per-repo identity.
2. **File size limit on full diffs.** `repos.getContent` caps at ~1 MB.
   Larger files silently fall back to empty content; the resulting "patch" will
   look like a full deletion or addition. There is currently no UI warning.
3. **`computePosition` is validation-only.** Its return value isn't passed to
   the GraphQL mutation. If you need the numeric position for the older REST
   `pulls.createReviewComment` endpoint, wire it through.
4. **Cross-file search scope.** `SearchAcrossFiles` only searches within the
   changed-hunk `patch` field, not the full file. Users may expect otherwise.
5. **Legacy parameters in the API surface.** `createReviewComment` accepts a
   `commitId` and `submitReview` accepts `comments?` that the main handlers
   don't use. Safe to drop in a future cleanup, but check both `preload.ts` and
   `services/api.d.ts`.
6. **No automated tests.** All verification today is manual via `npm start`.
7. **No structured logging.** Main process uses ad-hoc `console.log` (e.g. the
   `[get-review-threads]` line).

---

## 9. Iteration Tabs (Push-Group Diff Comparison)

The PR detail screen exposes a horizontal **iteration tab bar** above the
file list / diff area, letting reviewers re-scope the diff to a single push
or to a comparison between two pushes.

### Conceptual model

An **iteration** is a group of commits that were pushed together on the PR
branch. GitHub does not expose push events as first-class objects on a PR, so
iterations are derived client-side from `pulls.listCommits`:

- Commits are returned in chronological order.
- Consecutive commits whose `committer.date` (falling back to `author.date`)
  timestamps are within **`ITERATION_GAP_MS` (60 000 ms)** of each other are
  treated as one push.
- For iteration `i`:
  - `headSha` = SHA of the last commit in the group.
  - `baseSha` = `headSha` of iteration `i-1`, or the PR's `baseSha` for the
    first iteration.

Force-pushes appear as new iterations naturally because the rewritten commits
carry fresh `committer.date` timestamps. The heuristic can mis-group commits
when a single push is internally slow (>60 s between commits) or two pushes
land within 60 s of each other — acceptable for a v1, refinable later by
walking the issue timeline for force-push events.

### Tab semantics

| Tab               | `baseSha`              | `headSha`              |
|-------------------|------------------------|------------------------|
| **All**           | PR `baseSha`           | PR `headSha`           |
| **#N**            | iteration `N.baseSha`  | iteration `N.headSha`  |
| **#A → #B**       | iteration `A.headSha`  | iteration `B.headSha`  |

The "All" tab is the default and matches the pre-existing behavior. Clicking
any tab triggers `compareRefs(baseSha, headSha)` (or `getPRFiles` for "All")
to refresh the file list, then `getFullDiff` is called per file with the
active range's SHAs.

### Drag-and-drop comparison

Each iteration tab is `draggable`. Dragging tab A onto tab B emits an
`ActiveRange` of `kind: 'compare'` with `from` and `to` ordered by iteration
number (lower → higher). A transient "#A → #B" chip with an `✕` close button
appears in the tab bar; closing it returns to the "All" tab.

### Implementation map

| Concern                       | Location                                            |
|-------------------------------|-----------------------------------------------------|
| Push-group derivation         | `main.ts` — `github:get-iterations`                 |
| Arbitrary-ref file list       | `main.ts` — `github:compare-refs` (uses `repos.compareCommitsWithBasehead`) |
| Full-file diff per range      | `main.ts` — `github:get-full-diff` (already accepts arbitrary refs) |
| Active range state            | `App.tsx` — `iterations`, `activeRange`             |
| Tab UI + drag/drop            | `components/IterationTabs.tsx`                      |
| Styling                       | `app.css` — `.iteration-tabs`, `.iter-tab*`         |

### Caveats

- **Review threads are not filtered by iteration** in v1. All threads render
  inline at their `(path, line, side)` regardless of which range is active.
  Filtering by `comment.commit_id` reachability is a future refinement.
- **Pending review comments** are PR-global; switching iteration tabs does
  not change what gets submitted. The "Submit Review" badge counts apply
  across all iterations.
- **Line numbers across iterations.** When viewing iteration N, `getFullDiff`
  reconstructs the patch from full file contents at `iteration.baseSha` vs
  `iteration.headSha`. `computePosition` (used by `add-review-comment`) walks
  that patch, so the position-validation gate stays correct for the active
  range.

---



## 10. Markdown Preview

Markdown files (`.md`, `.markdown`, `.mdx`) can be viewed as a **rendered
preview** in addition to their diff. A `Diff | Preview` toggle appears in the
`diff-file-header` only when the selected file is Markdown.

### Behavior

- **Diff** (default) — the normal full-file diff, unchanged.
- **Preview** — the file rendered to HTML. The version shown respects the file
  status and the active iteration range:
  - `removed` → base version (`baseSha` of the active range).
  - everything else → head version (`headSha` of the active range).
- Switching files or fetching a new patch resets back to Diff mode.

### Data flow

```
DiffViewer (previewMode && markdown)
  → window.api.getFileContent(owner, repo, path, ref)
      → main: repos.getContent → base64 decode → { content }
  → marked.parse(content)            # GFM → HTML
  → DOMPurify.sanitize(html)         # strip scripts/handlers
  → dangerouslySetInnerHTML
```

`ref` is the active range's head SHA (or base SHA for deleted files), so the
preview stays consistent with whichever iteration tab is selected.

### Implementation map

| Concern                     | Location                                          |
|-----------------------------|---------------------------------------------------|
| Raw content fetch           | `main.ts` — `github:get-file-content`             |
| Preload/type binding        | `preload.ts` + `services/api.d.ts` — `getFileContent` |
| Render + sanitize           | `components/MarkdownPreview.tsx`                   |
| Toggle + wiring             | `components/DiffViewer.tsx` (`previewMode`, `baseSha`/`headSha` props) |
| Styling                     | `app.css` — `.markdown-body`, `.md-toggle`        |
| Dependencies                | `marked` (GFM), `dompurify` (sanitize)            |

### Caveats

- **Sanitization is mandatory.** Rendered HTML is always passed through
  `DOMPurify.sanitize` before `dangerouslySetInnerHTML`. Never bypass this.
- **Relative images are inlined.** Repo-relative image paths (e.g.
  `./img/logo.png` or `/docs/logo.png`) are resolved against the Markdown
  file's directory, fetched through the authenticated main process
  (`github:get-file-raw`), and embedded as `data:` URIs — so they render under
  CSP and work for private repos. Relative **links** are still not rewritten.
- **CSP allows `data:` and `https:` images.** `index.html`'s `img-src` permits
  inlined data URIs plus any `https:` host (badges, absolute image URLs).
- **No inline comments in Preview.** Review comments are a diff-only affordance;
  the preview is read-only. Right-click commenting and Find (Ctrl+F) are disabled
  while previewing.
- **File-size limit inherited.** `get-file-content` uses `repos.getContent`,
  which caps at ~1 MB (see §8). Larger Markdown files return an error surfaced
  in the preview pane.

---



## 11. Comments Navigator

The PR detail toolbar exposes a persistent **Comments** panel containing all
review threads plus locally tracked pending comments. It floats on the right
side of the workspace and remains open while reviewers navigate.

### Status model

Thread metadata comes from the paginated GraphQL `reviewThreads` connection.
Lifecycle and location are independent:

- **Pending** — the root comment belongs to a pending review.
- **Open** — submitted and unresolved.
- **Resolved** — `isResolved` is true; `resolvedBy` is shown when available.
- **Outdated** — `isOutdated` is true and appears as an additional badge.

Filters show counts for All, Open, Resolved, Pending, and Outdated. Threads are
grouped by path and ordered by line. Each row shows author, age, line, reply
count, root-comment excerpt, and status badges.

### Navigation

Selecting a thread keeps the panel open and:

1. Highlights the selected list item.
2. Switches to the All iteration if the current range cannot reliably show the
   comment location.
3. Loads the associated file.
4. Switches to Inline view, where review threads are rendered.
5. Scrolls to the `(side, currentLine || originalLine)` anchor and briefly
   highlights the inline thread.

If no line is available, the file opens at the top. Opening Comments closes
cross-file Search and Find; the panel closes through its toolbar toggle, close
button, or Escape.

---

## 12. Adding a New Capability — Checklist

When adding a feature that needs new data from GitHub:

1. Add an `ipcMain.handle('namespace:action', ...)` in `src/main/main.ts`.
2. Add a method on `window.api` in `src/preload/preload.ts`.
3. Add its signature to the `Api` interface in
   `src/renderer/services/api.d.ts`.
4. Consume it from a component, branching on `result.success`.
5. If it returns a list, paginate.
6. If it mutates server state, refresh dependent renderer state (e.g.
   `refreshThreads()` pattern).
7. Update this DESIGN.md if the change is architectural (new screen, new
   storage key, new IPC namespace, new external dependency).

---

## 13. Tech Stack Summary

| Layer            | Library / Tool                          |
|------------------|------------------------------------------|
| Desktop shell    | Electron 33                              |
| UI framework     | React 18                                 |
| Language         | TypeScript 5.5                           |
| Bundler          | Webpack 5 + ts-loader                    |
| GitHub client    | `@octokit/rest` 21 (REST + GraphQL)      |
| Diff generation  | `diff` (`createTwoFilesPatch`)           |
| Markdown render  | `marked` (GFM) + `dompurify` (sanitize)  |
| Persistent store | `electron-store` 8                       |
| Packaging        | `electron-builder` 26                    |
