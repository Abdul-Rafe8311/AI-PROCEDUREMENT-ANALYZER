'use client';

// Persistence for a Tender Comparative Sheet: one row per analysis, template +
// answers as JSON (see supabase/migrations/0003_tender_sheets.sql).
//
// Best-effort, like the rest of the workspace's persistence: when Supabase is not
// configured the app still works, the sheet just lives in memory for the session.
// A save never blocks the reviewer.

import { isSupabaseConfigured, supabase } from '../supabase';
import type { TenderSheet } from './types';

export async function loadTenderSheet(analysisId: string): Promise<TenderSheet | null> {
  if (!isSupabaseConfigured || !supabase || !analysisId) return null;
  try {
    const { data, error } = await supabase
      .from('tender_sheets')
      .select('template, answers, updated_at')
      .eq('analysis_id', analysisId)
      .maybeSingle();
    if (error || !data?.template) return null;
    return {
      template: data.template as TenderSheet['template'],
      answers: (data.answers ?? {}) as TenderSheet['answers'],
      updatedAt: data.updated_at as string | undefined,
    };
  } catch {
    return null; // requires the tender_sheets table — see the migration
  }
}

export async function saveTenderSheet(analysisId: string, sheet: TenderSheet): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase || !analysisId) return false;
  try {
    const { error } = await supabase.from('tender_sheets').upsert(
      {
        analysis_id: analysisId,
        template: sheet.template,
        answers: sheet.answers,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'analysis_id' },
    );
    return !error;
  } catch {
    return false;
  }
}
