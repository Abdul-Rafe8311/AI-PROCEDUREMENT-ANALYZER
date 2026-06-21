'use client';

import { useCallback, useRef, useState } from 'react';
import { FileText, Loader2, Upload, X } from 'lucide-react';
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

export function UploadZone({
  files,
  onAdd,
  onRemove,
  onAnalyze,
  busy,
  analyzing,
}: {
  files: File[];
  onAdd: (files: File[]) => void;
  onRemove: (index: number) => void;
  onAnalyze: () => void;
  busy: boolean;
  analyzing: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = useCallback(
    (list: FileList | null) => {
      if (!list) return;
      const accepted = Array.from(list).filter(isAccepted);
      if (accepted.length) onAdd(accepted);
    },
    [onAdd],
  );

  return (
    <div className="space-y-4">
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
          'flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition',
          dragging
            ? 'border-primary bg-primary/5'
            : 'border-border bg-muted/30 hover:border-primary/50 hover:bg-muted/50',
        )}
      >
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Upload className="h-6 w-6" />
        </span>
        <p className="mt-4 text-base font-semibold">Drag &amp; drop supplier quotations</p>
        <p className="mt-1 text-sm text-muted-foreground">
          or <span className="font-medium text-primary">browse files</span>
        </p>
        <p className="mt-3 text-xs text-muted-foreground">Supported: PDF, DOCX, PNG, JPG</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={acceptAttr}
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {files.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-semibold">
              {files.length} file{files.length === 1 ? '' : 's'} ready
            </span>
            {busy && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading…
              </span>
            )}
          </div>
          <ul className="space-y-2">
            {files.map((file, i) => (
              <li
                key={`${file.name}-${i}`}
                className="flex items-center justify-between rounded-lg border border-border/70 bg-background px-3 py-2"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <FileText className="h-4 w-4 shrink-0 text-primary" />
                  <span className="truncate text-sm font-medium">{file.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatSize(file.size)}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => onRemove(i)}
                  disabled={busy}
                  className="rounded-md p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-50"
                  aria-label={`Remove ${file.name}`}
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={onAnalyze}
            disabled={busy || analyzing}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {analyzing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Analyzing quotations…
              </>
            ) : (
              'Analyze Quotations'
            )}
          </button>
        </div>
      )}
    </div>
  );
}
