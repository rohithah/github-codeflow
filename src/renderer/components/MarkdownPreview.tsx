import React, { useEffect, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdx'];

export function isMarkdownFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return MARKDOWN_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

marked.setOptions({ gfm: true, breaks: false });

// Resolve a relative markdown asset path against the directory of the md file.
// Leading '/' is treated as repo-root-relative. Returns a repo-relative path.
function resolveRepoPath(baseDir: string, src: string): string {
  const clean = src.split('#')[0].split('?')[0];
  if (clean.startsWith('/')) return clean.replace(/^\/+/, '');
  const stack = baseDir ? baseDir.split('/').filter(Boolean) : [];
  for (const part of clean.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}

function isRemoteOrData(src: string): boolean {
  return /^(https?:)?\/\//i.test(src) || src.startsWith('data:');
}

interface Props {
  owner: string;
  repo: string;
  filename: string;
  gitRef: string;
}

export default function MarkdownPreview({ owner, repo, filename, gitRef }: Props) {
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setHtml(null);

    (async () => {
      try {
        const result = await window.api.getFileContent(owner, repo, filename, gitRef);
        if (cancelled) return;
        if (!result.success) {
          setLoading(false);
          setError(result.error || 'Failed to load file');
          return;
        }

        const rawHtml = marked.parse(result.content, { async: false }) as string;

        // Inline repo-relative images as data URIs so they render under CSP and
        // work for private repos (fetched with the authenticated token).
        const doc = new DOMParser().parseFromString(rawHtml, 'text/html');
        const imgs = Array.from(doc.querySelectorAll('img'));
        const baseDir = filename.includes('/') ? filename.slice(0, filename.lastIndexOf('/')) : '';

        await Promise.all(
          imgs.map(async (img) => {
            const src = img.getAttribute('src') || '';
            if (!src || isRemoteOrData(src)) return;
            const repoPath = resolveRepoPath(baseDir, src);
            if (!repoPath) return;
            try {
              const res = await window.api.getFileRaw(owner, repo, repoPath, gitRef);
              if (res.success) img.setAttribute('src', res.dataUri);
            } catch {
              /* leave broken img as-is */
            }
          }),
        );

        if (cancelled) return;
        const processed = doc.body.innerHTML;
        setLoading(false);
        setHtml(DOMPurify.sanitize(processed, { USE_PROFILES: { html: true } }));
      } catch (e: any) {
        if (cancelled) return;
        setLoading(false);
        setError(e.message || 'Failed to render markdown');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [owner, repo, filename, gitRef]);

  if (loading) {
    return (
      <div className="md-preview md-preview-status">
        <div className="spinner" />
        <p>Rendering preview...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="md-preview md-preview-status">
        <p>⚠ {error}</p>
      </div>
    );
  }

  return (
    <div
      className="md-preview markdown-body"
      dangerouslySetInnerHTML={{ __html: html || '' }}
    />
  );
}
