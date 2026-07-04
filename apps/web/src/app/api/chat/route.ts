import { NextResponse } from 'next/server';
import { answerFromData } from '@/lib/analysis-engine';
import { answerWithClaude, CHAT_MODEL, isAnthropicConfigured } from '@/lib/anthropic';
import type { AnalysisResult, ChatMessage } from '@/lib/workspace-types';

export const runtime = 'nodejs';
export const maxDuration = 30;

const log = (...args: unknown[]) => console.error('[api/chat]', ...args);

interface ChatBody {
  question: string;
  analysis: AnalysisResult;
  history?: Pick<ChatMessage, 'role' | 'content'>[];
}

// POST /api/chat — answers comparison questions about the analyzed quotations.
// Primary: Anthropic Claude (claude-sonnet-4-6). If ANTHROPIC_API_KEY is missing
// or the call fails, it degrades to a deterministic answer computed from the
// SAME analysis data (never sample/fabricated data) and says so via `notice`.
export async function POST(req: Request) {
  let body: ChatBody;
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const { question, analysis, history = [] } = body;
  if (!question?.trim()) {
    return NextResponse.json({ error: 'Question is required.' }, { status: 400 });
  }
  if (!analysis?.quotations?.length) {
    return NextResponse.json({
      answer: 'Upload and analyze some quotations first, then ask me anything about them.',
    });
  }

  // Clear degraded state when the AI provider is not configured — no silent
  // failure, no sample data: a real computed answer plus a visible notice.
  if (!isAnthropicConfigured()) {
    return NextResponse.json({
      answer: answerFromData(question, analysis),
      source: 'rules',
      notice: 'AI chat is not configured (ANTHROPIC_API_KEY missing) — showing a computed answer from your data.',
    });
  }

  const system = [
    'You are a procurement analyst assistant for construction/manufacturing buyers.',
    'Answer concisely and ONLY from the supplier quotation data provided as JSON.',
    'The data includes per-supplier totals, delivery days, payment terms, warranty,',
    'risk flags (with severity), and itemized lineItems (name, quantity, unitPrice,',
    'totalPrice, currency). For item questions (e.g. "lowest steel price") compare the',
    'matching lineItems across suppliers. Always state the currency. Use totalCostUsd',
    'for cross-currency comparisons and say so.',
    'If asked to list items/goods and lineItems is EMPTY for every supplier, do NOT',
    'just say "cannot answer" — explain that no itemized goods/pricing table was',
    'extracted from the document, and suggest asking about cost, delivery, payment',
    'terms, or warranty, or using deep document search for the contract wording.',
    'For other unanswerable questions, say so briefly.',
    '',
    `QUOTATION DATA:\n${JSON.stringify(analysis, null, 2)}`,
  ].join('\n');

  try {
    const answer = await answerWithClaude({
      system,
      messages: [
        ...history.slice(-6).map((m) => ({ role: m.role, content: m.content })),
        { role: 'user' as const, content: question },
      ],
      maxTokens: 1024,
    });
    if (!answer) {
      return NextResponse.json({ answer: answerFromData(question, analysis), source: 'rules' });
    }
    return NextResponse.json({ answer, source: 'claude', model: CHAT_MODEL });
  } catch (err) {
    // Claude failed (rate limit, outage, bad key) — degrade to real computed data.
    log(`Claude chat failed: ${(err as Error).message}`);
    return NextResponse.json({
      answer: answerFromData(question, analysis),
      source: 'rules',
      notice: 'AI chat is temporarily unavailable — showing a computed answer from your data.',
    });
  }
}
