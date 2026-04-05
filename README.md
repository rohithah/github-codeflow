# GitHub CodeFlow

A desktop PR diff viewer for GitHub, built with Electron + React + TypeScript.

## Features

- **GitHub Auth** — Sign in via `gh` CLI or Personal Access Token
- **PR Browser** — Enter `owner/repo`, paste a PR URL, or pick from recent repos
- **Full-File Diff** — See the entire file with changes highlighted, not just hunks
- **Split & Inline Views** — Toggle between side-by-side and inline diff modes
- **CodeFlow-Style Theme** — Light theme with red strikethrough deletions, yellow additions, change markers
- **File Tree** — Collapsible directory tree sidebar with status badges
- **Review Comments** — Right-click to add comments to a pending review, submit all at once
- **Change Navigation** — ▲/▼ arrows to jump between changes
- **Find in File** — `Ctrl+F` to search within the current file
- **Search Across Files** — `Ctrl+Shift+F` to search all changed files
- **Resizable Sidebar** — Drag to resize the file tree
- **Recent Repos** — Quick access to recently viewed repositories

## Getting Started

```bash
npm install
npm start
```

## Auth

The easiest way to authenticate is via the GitHub CLI:

```bash
gh auth login
```

Then click "Sign in with GitHub CLI" in the app. Alternatively, use a Personal Access Token with `repo` scope.

## Tech Stack

- **Electron** — Desktop shell
- **React 18** — UI framework
- **TypeScript** — Type safety
- **Webpack** — Build tooling
- **Octokit** — GitHub API client
- **diff** — Full-file diff generation
