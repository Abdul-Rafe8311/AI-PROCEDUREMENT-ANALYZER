'use client';

// The Customize editor for the Tender Comparative Sheet. Mirrors the TA form's
// Customize pattern: an "AI suggested" badge that flips to "Your value" once a
// cell is edited, and a reset that restores the AI's answer.
//
// Everything the buyer can restructure is here: rename or remove a criteria
// section, add or remove the parameters under an item (the chemical list is
// genuinely per-item), edit any cell, and show or hide a supplier column.

import { useState, type ReactNode } from 'react';
import { Plus, RotateCcw, Sparkles, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { answerKey, type TenderSheet, type TemplateSection } from '@/lib/tender-sheet/types';

export function TenderSheetDialog({
  sheet,
  onChange,
  children,
}: {
  sheet: TenderSheet | null;
  onChange: (next: TenderSheet) => void;
  children: ReactNode;
}) {
  const [openSection, setOpenSection] = useState<string | null>(null);
  if (!sheet) return <>{children}</>;
  const { template, answers } = sheet;

  const put = (next: Partial<TenderSheet>) => onChange({ ...sheet, ...next });
  const setSections = (sections: TemplateSection[]) => put({ template: { ...template, sections } });

  const editCell = (key: string, value: string) =>
    put({ answers: { ...answers, [key]: { ...(answers[key] ?? { source: 'user' }), value, source: 'user' } } });
  const resetCell = (key: string) => {
    const cur = answers[key];
    if (!cur) return;
    const next = { ...answers };
    if (cur.aiValue) next[key] = { value: cur.aiValue, source: 'ai', aiValue: cur.aiValue };
    else delete next[key];
    put({ answers: next });
  };

  const renameSection = (id: string, title: string) =>
    setSections(template.sections.map((s) => (s.id === id ? { ...s, title } : s)));
  const removeSection = (id: string) =>
    setSections(template.sections.filter((s) => s.id !== id).map((s, i) => ({ ...s, slNo: i + 1 })));
  const addCriterion = () =>
    setSections([
      ...template.sections,
      { id: `commercial-${Date.now()}`, slNo: template.sections.length + 1, title: 'New criterion', type: 'single_row' },
    ]);

  const addParameter = (sectionId: string, itemNo: number, name: string) =>
    setSections(
      template.sections.map((s) =>
        s.id !== sectionId
          ? s
          : {
              ...s,
              items: s.items?.map((it) =>
                it.itemNo !== itemNo ? it : { ...it, parameters: [...it.parameters, { name, requiredValue: null }] },
              ),
            },
      ),
    );
  const removeParameter = (sectionId: string, itemNo: number, name: string) =>
    setSections(
      template.sections.map((s) =>
        s.id !== sectionId
          ? s
          : {
              ...s,
              items: s.items?.map((it) =>
                it.itemNo !== itemNo ? it : { ...it, parameters: it.parameters.filter((p) => p.name !== name) },
              ),
            },
      ),
    );
  const toggleSupplier = (supplierId: string) =>
    put({
      template: {
        ...template,
        suppliers: template.suppliers.map((s) => (s.supplierId === supplierId ? { ...s, quoted: !s.quoted } : s)),
      },
    });

  /** One editable cell, with the TA form's badge + reset behaviour. */
  const Cell = ({ sectionId, itemNo, parameter }: { sectionId: string; itemNo: number | null; parameter: string | null }) => (
    <div className="space-y-1.5">
      {template.suppliers.map((sup) => {
        const key = answerKey(sectionId, itemNo, parameter, sup.supplierId);
        const a = answers[key];
        const edited = a?.source === 'user';
        return (
          <div key={sup.supplierId}>
            <div className="mb-0.5 flex items-center justify-between gap-2">
              <span className="truncate text-[11px] font-medium text-muted-foreground">{sup.name}</span>
              {edited ? (
                <span className="shrink-0 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">Your value</span>
              ) : a?.value ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                  <Sparkles className="h-2.5 w-2.5" /> AI suggested
                </span>
              ) : null}
            </div>
            <textarea
              value={a?.value ?? ''}
              onChange={(e) => editCell(key, e.target.value)}
              rows={Math.min(4, Math.max(1, (a?.value ?? '').split('\n').length))}
              placeholder="not stated in this quotation"
              className={cn(
                'w-full resize-y rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary',
                !edited && a?.value && 'italic text-primary',
              )}
            />
            {edited && a?.aiValue && (
              <button
                type="button"
                onClick={() => resetCell(key)}
                className="mt-0.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                <RotateCcw className="h-2.5 w-2.5" /> Reset to AI suggestion
              </button>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Customize the Tender Comparative Sheet</DialogTitle>
          <DialogDescription>
            Edit any value before exporting. An AI-read cell is marked; editing it makes it yours, and re-running
            Generate never overwrites a cell you have edited. Empty means the quotation did not state it.
          </DialogDescription>
        </DialogHeader>

        {/* ── supplier columns ── */}
        <section className="mt-1">
          <h4 className="mb-1.5 text-sm font-semibold">Supplier columns</h4>
          <div className="flex flex-wrap gap-1.5">
            {template.suppliers.map((s) => (
              <button
                key={s.supplierId}
                type="button"
                onClick={() => toggleSupplier(s.supplierId)}
                className={cn(
                  'rounded-md border px-2 py-1 text-[11px] font-medium transition',
                  s.quoted ? 'border-primary/30 bg-primary/10 text-primary' : 'border-dashed border-border text-muted-foreground',
                )}
                title={s.quoted ? 'Shown — click to mark as not quoting' : 'Marked as not quoting'}
              >
                {s.name}
              </button>
            ))}
          </div>
        </section>

        {/* ── criteria ── */}
        <section className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-semibold">Criteria</h4>
            <button
              type="button"
              onClick={addCriterion}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <Plus className="h-3 w-3" /> Add criterion
            </button>
          </div>

          <ul className="space-y-2">
            {template.sections.map((section) => {
              const open = openSection === section.id;
              return (
                <li key={section.id} className="rounded-lg border border-border">
                  <div className="flex items-center gap-2 px-3 py-2">
                    <span className="w-6 shrink-0 text-xs text-muted-foreground">{section.slNo}</span>
                    <input
                      value={section.title}
                      onChange={(e) => renameSection(section.id, e.target.value)}
                      className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm font-medium outline-none hover:border-border focus:border-primary"
                    />
                    <button
                      type="button"
                      onClick={() => setOpenSection(open ? null : section.id)}
                      className="shrink-0 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
                    >
                      {open ? 'Hide' : 'Edit values'}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeSection(section.id)}
                      title="Remove this criterion"
                      className="shrink-0 rounded-md px-1.5 py-1 text-muted-foreground transition hover:bg-danger/10 hover:text-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {open && (
                    <div className="space-y-3 border-t border-border p-3">
                      {section.type === 'single_row' ? (
                        <Cell sectionId={section.id} itemNo={null} parameter={null} />
                      ) : (
                        (section.items ?? []).map((item) => (
                          <div key={item.itemNo} className="rounded-md border border-border p-2.5">
                            <div className="mb-1.5 text-xs font-semibold">
                              Item {item.itemNo}
                              {item.requiredSpec ? (
                                <span className="ml-1 font-normal text-muted-foreground">— {item.requiredSpec.slice(0, 70)}</span>
                              ) : null}
                            </div>

                            {section.type === 'per_item_params' || section.type === 'per_item_pairs' ? (
                              <>
                                <ul className="space-y-2">
                                  {item.parameters.map((p) => (
                                    <li key={p.name}>
                                      <div className="mb-1 flex items-center justify-between gap-2">
                                        <span className="text-[11px] font-medium">{p.name}</span>
                                        <button
                                          type="button"
                                          onClick={() => removeParameter(section.id, item.itemNo, p.name)}
                                          title={`Remove ${p.name}`}
                                          className="rounded px-1 py-0.5 text-muted-foreground transition hover:bg-danger/10 hover:text-danger"
                                        >
                                          <X className="h-3 w-3" />
                                        </button>
                                      </div>
                                      {/* pairs sections carry one cell for the whole item */}
                                      {section.type === 'per_item_params' && (
                                        <Cell sectionId={section.id} itemNo={item.itemNo} parameter={p.name} />
                                      )}
                                    </li>
                                  ))}
                                </ul>
                                <AddParameter onAdd={(name) => addParameter(section.id, item.itemNo, name)} />
                                {section.type === 'per_item_pairs' && (
                                  <div className="mt-2">
                                    <Cell sectionId={section.id} itemNo={item.itemNo} parameter={null} />
                                  </div>
                                )}
                              </>
                            ) : (
                              <Cell sectionId={section.id} itemNo={item.itemNo} parameter={null} />
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </DialogContent>
    </Dialog>
  );
}

function AddParameter({ onAdd }: { onAdd: (name: string) => void }) {
  const [name, setName] = useState('');
  return (
    <div className="mt-2 flex items-center gap-1.5">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="add a parameter (e.g. ZrO2, Porosity)"
        className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary"
      />
      <button
        type="button"
        disabled={!name.trim()}
        onClick={() => {
          onAdd(name.trim());
          setName('');
        }}
        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
      >
        <Plus className="h-3 w-3" /> Add
      </button>
    </div>
  );
}
