'use client';

import { useState } from 'react';
import { AlertTriangle, Languages } from 'lucide-react';
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

        <pre
          dir={view === 'original' ? 'rtl' : 'ltr'}
          className="max-h-[55vh] overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/20 p-4 font-sans text-sm leading-relaxed text-foreground"
        >
          {view === 'en' ? translation.englishText : translation.originalText}
        </pre>

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
