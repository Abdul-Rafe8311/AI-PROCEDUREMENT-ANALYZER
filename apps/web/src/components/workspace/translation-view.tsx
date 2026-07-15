'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, Languages } from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import type { DocumentTranslation } from '@/lib/workspace-types';
import { cn } from '@/lib/utils';

const langLabel = (l: DocumentTranslation['language']) => (l === 'bilingual' ? 'Arabic/English' : 'Arabic');

// Neutral, document-style Markdown renderer for the translated quotation: readable
// prose + a real items TABLE (GFM), so the manager never sees raw pipes or a
// run-on wall of text. Deliberately plain (no chat check-marks / warning cards).
const docComponents: Components = {
  h1: ({ children }) => <h2 className="mb-1.5 mt-4 text-base font-bold tracking-tight text-foreground">{children}</h2>,
  h2: ({ children }) => <h3 className="mb-1.5 mt-4 text-sm font-bold tracking-tight text-foreground">{children}</h3>,
  h3: ({ children }) => <h4 className="mb-1 mt-3 text-sm font-semibold text-foreground">{children}</h4>,
  p: ({ children }) => <p className="my-1.5 text-sm leading-relaxed text-foreground/90">{children}</p>,
  ul: ({ children }) => <ul className="my-1.5 list-disc space-y-1 pl-5 text-sm text-foreground/90">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-1 pl-5 text-sm text-foreground/90">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic text-foreground/90">{children}</em>,
  hr: () => <hr className="my-3 border-border" />,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="font-medium text-primary underline underline-offset-2">
      {children}
    </a>
  ),
  // The items table — scannable, aligned, horizontally scrollable on narrow screens.
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-left text-xs tabular-nums">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-muted/60 text-[10.5px] uppercase tracking-wide text-muted-foreground">{children}</thead>
  ),
  tbody: ({ children }) => <tbody className="divide-y divide-border">{children}</tbody>,
  tr: ({ children }) => <tr>{children}</tr>,
  th: ({ children }) => <th className="whitespace-nowrap px-3 py-2 font-semibold">{children}</th>,
  td: ({ children }) => <td className="px-3 py-2 align-top text-foreground/90">{children}</td>,
  code: ({ children }) => <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">{children}</code>,
};

function TranslatedMarkdown({ content }: { content: string }) {
  const tree = useMemo(
    () => (
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={docComponents}>
        {content}
      </ReactMarkdown>
    ),
    [content],
  );
  return <div className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0">{tree}</div>;
}

/**
 * A "Translated from Arabic · View" badge that opens the full-document translation.
 * Default view is the ENGLISH translation (the manager reads it without toggling);
 * a toggle reveals the ORIGINAL Arabic, which stays the binding text. Machine
 * translation is clearly labelled and any translator flags are surfaced.
 */
export function TranslationBadge({
  translation,
  supplierName,
}: {
  translation: DocumentTranslation;
  supplierName: string;
}) {
  const [view, setView] = useState<'en' | 'original'>('en');
  const label = langLabel(translation.language);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary transition hover:bg-primary/15"
          title={`This quotation was in ${label}. View the English translation (original stays available).`}
        >
          <Languages className="h-3 w-3" />
          Translated from {label} · View
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{supplierName} — quotation</DialogTitle>
          <DialogDescription>
            Machine translation by {translation.model}. The original {label} document is the binding text — the
            English is a convenience for reading. Numbers, prices, dates, references and part codes are passed
            through unchanged.
          </DialogDescription>
        </DialogHeader>

        {/* English is the default; toggle to the binding original. */}
        <div className="flex w-fit items-center gap-1 rounded-lg border border-border bg-muted/40 p-0.5 text-xs font-medium">
          <button
            type="button"
            onClick={() => setView('en')}
            className={cn(
              'rounded-md px-3 py-1 transition',
              view === 'en' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            English translation
          </button>
          <button
            type="button"
            onClick={() => setView('original')}
            className={cn(
              'rounded-md px-3 py-1 transition',
              view === 'original' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Original ({label})
          </button>
        </div>

        {translation.notes.length > 0 && (
          <div className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
            <div className="mb-1 flex items-center gap-1.5 font-semibold">
              <AlertTriangle className="h-3.5 w-3.5" />
              Translator flags — review against the original
            </div>
            <ul className="list-disc space-y-0.5 pl-4 text-foreground/80">
              {translation.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
        )}

        {view === 'en' ? (
          <div className="max-h-[55vh] overflow-auto rounded-lg border border-border bg-muted/20 p-4">
            <TranslatedMarkdown content={translation.englishText} />
          </div>
        ) : (
          <pre
            dir="rtl"
            className="max-h-[55vh] overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/20 p-4 font-sans text-sm leading-relaxed text-foreground"
          >
            {translation.originalText}
          </pre>
        )}

        {translation.truncated && view === 'en' && (
          <p className="text-[11px] text-muted-foreground">
            This is a long document — only the first part was translated. See the original for the remainder.
          </p>
        )}
        <p className="text-[11px] text-muted-foreground">
          Extracted fields (in the comparison table and the Technical Approval Form) were read from the original{' '}
          {label} document, not from this translation.
        </p>
      </DialogContent>
    </Dialog>
  );
}
