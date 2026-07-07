'use client';

import { useCallback, useRef, useState } from 'react';
import { ClipboardList, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ACCEPTED_EXTENSIONS } from '@/lib/workspace-types';

const acceptAttr = '.pdf,.docx,.png,.jpg,.jpeg';

function isAccepted(file: File): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return (ACCEPTED_EXTENSIONS as readonly string[]).includes(ext);
}

const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * Optional single-file uploader for the company's own Purchase Requisition (PR)
 * — the buyer's internal "Approved Requisition Report". Kept separate from the
 * supplier-quotation dropzone so the two document types stay unambiguous.
 * Selecting a new file replaces the current one (there is only ever one PR).
 */
export function PrUpload({
  file,
  onSelect,
  onClear,
  busy,
}: {
  file: File | null;
  onSelect: (file: File) => void;
  onClear: () => void;
  busy: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = useCallback(
    (list: FileList | null) => {
      if (!list || !list.length) return;
      const first = Array.from(list).find(isAccepted);
      if (first) onSelect(first);
    },
    [onSelect],
  );

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <ClipboardList className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">Company Purchase Requisition</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Optional
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Upload your internal PR / Approved Requisition to match supplier items against it.
          </p>
        </div>
      </div>

      {file ? (
        <div className="flex items-center justify-between rounded-lg border border-border/70 bg-background px-3 py-2">
          <span className="flex min-w-0 items-center gap-2.5">
            <ClipboardList className="h-4 w-4 shrink-0 text-primary" />
            <span className="truncate text-sm font-medium">{file.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{formatSize(file.size)}</span>
          </span>
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <button
              type="button"
              onClick={onClear}
              className="rounded-md p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground"
              aria-label={`Remove ${file.name}`}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      ) : (
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            handleFiles(e.dataTransfer.files);
          }}
          className={cn(
            'flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-3 text-center text-sm transition',
            dragging
              ? 'border-primary bg-primary/5 text-primary'
              : 'border-border bg-muted/20 text-muted-foreground hover:border-primary/50 hover:bg-muted/40',
          )}
        >
          <span>
            Drop your PR here or <span className="font-medium text-primary">browse</span>
            <span className="ml-1 text-xs text-muted-foreground">(PDF, DOCX, PNG, JPG)</span>
          </span>
          <input
            ref={inputRef}
            type="file"
            accept={acceptAttr}
            className="hidden"
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
      )}
    </div>
  );
}
