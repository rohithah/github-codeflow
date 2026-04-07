# GitHub CodeFlow

A lightweight desktop app for reviewing GitHub pull requests. Built with Electron, React, and TypeScript.

![GitHub CodeFlow](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue) ![License](https://img.shields.io/badge/license-MIT-green)

## What It Does

GitHub CodeFlow gives you a dedicated desktop experience for reviewing PRs with a full-file diff view, inline comments, and a file tree — features that go beyond what the GitHub web UI offers.

### 🔍 Full-File Diff View
Unlike GitHub's web UI which only shows changed hunks, CodeFlow fetches the **entire file** and highlights changes in context. Deleted lines appear with **red strikethrough**, additions with **yellow highlight**, and change markers in the gutter.

### 📂 File Tree Sidebar
Changed files are organized in a **collapsible directory tree** (not a flat list). Folders auto-collapse when they have a single child. Each file shows its status badge (Added/Modified/Deleted/Renamed) and +/- line counts. The sidebar is **resizable** by dragging.

### 💬 Review Comments
**Right-click any line** in the diff to add a review comment. Comments are added to a **pending review** — they accumulate as drafts until you're ready. Click **"Submit Review"** to publish all comments at once as a Comment, Approval, or Request Changes.

Existing review threads from GitHub load inline with the diff, including threaded replies.

### 🔎 Search
- **Ctrl+F** — Find text within the current file. Matches are highlighted with prev/next navigation.
- **Ctrl+Shift+F** — Search across all changed files in the PR. Results grouped by file, click to jump.

### ⚡ Quick Navigation
- **PR URL paste** — Paste `https://github.com/owner/repo/pull/123` directly into the search bar to jump straight to a PR
- **Shorthand** — Type `owner/repo#123` for quick access
- **Recent repos** — Previously viewed repos appear as clickable chips for instant access
- **Change arrows** — ▲/▼ buttons to jump between changes within a file
- **PR filters** — Filter by Open / Merged / Closed, sorted by most recently updated

### 🔐 Authentication
- **GitHub CLI** — One-click sign-in using your existing `gh auth` session (recommended)
- **Personal Access Token** — Paste a PAT with `repo` scope as an alternative

## Getting Started

### Install from Release

Download the latest installer from [Releases](https://github.com/rohithah/github-codeflow/releases):

| Platform | File |
|----------|------|
| Windows (installer) | `GitHub.CodeFlow.Setup.x.x.x.exe` |
| Windows (portable) | `GitHub.CodeFlow.x.x.x.exe` |
| macOS | `GitHub.CodeFlow-x.x.x-arm64.dmg` |
| Linux | `GitHub.CodeFlow-x.x.x.AppImage` or `.deb` |

### Build from Source

```bash
git clone https://github.com/rohithah/github-codeflow.git
cd github-codeflow
npm install
npm start
```

### Prerequisites

- [Node.js](https://nodejs.org/) 18+ (for building from source)
- [GitHub CLI](https://cli.github.com/) (optional, for one-click auth)

## Usage

1. **Sign in** — Click "Sign in with GitHub CLI" or paste a Personal Access Token
2. **Open a PR** — Paste a PR URL, type `owner/repo`, or click a recent repo
3. **Browse files** — Use the tree sidebar to navigate changed files
4. **Review** — Right-click lines to add comments, use Ctrl+F to search
5. **Submit** — Click "Submit Review" to publish all pending comments

## Tech Stack

- **[Electron](https://www.electronjs.org/)** — Cross-platform desktop shell
- **[React 18](https://react.dev/)** — UI framework
- **[TypeScript](https://www.typescriptlang.org/)** — Type safety
- **[Webpack](https://webpack.js.org/)** — Build tooling
- **[Octokit](https://github.com/octokit/octokit.js)** — GitHub REST + GraphQL API client
- **[diff](https://github.com/kpdecker/jsdiff)** — Full-file diff generation
- **[electron-builder](https://www.electron.build/)** — Packaging & installers

## License

MIT
