'use client';

// Renders an AI chat message from Markdown into clean, themed UI — so the user
// never sees raw Markdown syntax (###, ---, | tables |). Uses react-markdown +
// remark-gfm (GitHub-flavored: tables, strikethrough, task lists). All styling
// uses the existing dashboard theme tokens, so it inherits dark mode.

import { type ReactNode, useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AlertTriangle, Check, Trophy } from 'lucide-react';
import { cn } from '@/lib/utils';

// Flatten a heading's children to plain text so we can detect special headings.
function textOf(children: ReactNode): string {
  if (children == null || children === false) return '';
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(textOf).join('');
  if (typeof children === 'object' && 'props' in (children as { props?: { children?: ReactNode } })) {
    return textOf((children as { props?: { children?: ReactNode } }).props?.children);
  }
  return '';
}

const RECO_RE = /\b(recommend|final verdict|final recommendation|best overall|winner)\b/i;

const components: Components = {
  // Headings — a recommendation/verdict heading becomes a premium banner.
  h1: ({ children }) => <Heading level={1}>{children}</Heading>,
  h2: ({ children }) => <Heading level={2}>{children}</Heading>,
  h3: ({ children }) => <Heading level={3}>{children}</Heading>,
  h4: ({ children }) => <Heading level={4}>{children}</Heading>,

  p: ({ children }) => <p className="my-2 text-sm leading-relaxed text-foreground/90">{children}</p>,

  // Bullet/numbered lists render as clean check-marked items (key points).
  ul: ({ children }) => <ul className="my-2 space-y-1.5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 space-y-1.5">{children}</ol>,
  li: ({ children }) => (
    <li className="flex list-none gap-2 text-sm leading-relaxed text-foreground/90">
      <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
      <span className="min-w-0">{children}</span>
    </li>
  ),

  // Emphasis — bold is used for prices, supplier names, key numbers.
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic text-foreground/90">{children}</em>,

  // Blockquote → a yellow "things to verify" warning card.
  blockquote: ({ children }) => (
    <div className="my-3 flex gap-2.5 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-foreground">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
      <div className="min-w-0 space-y-1 [&_p]:my-0 [&_ul]:my-1">{children}</div>
    </div>
  ),

  // GFM tables → modern, scannable table (no raw pipes).
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-xl border border-border">
      <table className="w-full border-collapse text-left text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-muted/60 text-[10.5px] uppercase tracking-wide text-muted-foreground">{children}</thead>
  ),
  tbody: ({ children }) => <tbody className="divide-y divide-border">{children}</tbody>,
  tr: ({ children }) => <tr>{children}</tr>,
  th: ({ children }) => <th className="px-3 py-2 font-semibold">{children}</th>,
  td: ({ children }) => <td className="px-3 py-2 align-top text-foreground/90">{children}</td>,

  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="font-medium text-primary underline underline-offset-2">
      {children}
    </a>
  ),
  hr: () => <hr className="my-3 border-border" />,
  code: ({ className, children }) => {
    const block = /language-/.test(className ?? '');
    if (block) {
      return (
        <code className="block overflow-x-auto rounded-lg bg-muted/70 p-3 font-mono text-xs text-foreground">
          {children}
        </code>
      );
    }
    return <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">{children}</code>;
  },
  pre: ({ children }) => <pre className="my-2">{children}</pre>,
};

function Heading({ level, children }: { level: 1 | 2 | 3 | 4; children: ReactNode }) {
  const isReco = level <= 3 && RECO_RE.test(textOf(children));
  if (isReco) {
    return (
      <div className="my-3 flex items-center gap-2.5 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3">
        <Trophy className="h-5 w-5 shrink-0 text-primary" />
        <span className="text-[15px] font-bold tracking-tight text-foreground">{children}</span>
      </div>
    );
  }
  return (
    <div
      className={cn(
        'font-bold tracking-tight text-foreground',
        level === 1 && 'mb-1.5 mt-3 text-lg',
        level === 2 && 'mb-1.5 mt-4 text-base',
        level === 3 && 'mb-1 mt-3 text-sm',
        level === 4 && 'mb-1 mt-2 text-sm text-muted-foreground',
      )}
    >
      {children}
    </div>
  );
}

export function ChatMarkdown({ content, className }: { content: string; className?: string }) {
  // Memoize: parsing is pure and messages don't change once rendered.
  const tree = useMemo(
    () => (
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    ),
    [content],
  );
  return (
    <div className={cn('text-sm text-foreground [&>*:first-child]:mt-0 [&>*:last-child]:mb-0', className)}>
      {tree}
    </div>
  );
}
