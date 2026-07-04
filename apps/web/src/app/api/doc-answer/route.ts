import { NextResponse } from 'next/server';
import { answerWithClaude, CHAT_MODEL, isAnthropicConfigured } from '@/lib/anthropic';

export const runtime = 'nodejs';
export const maxDuration = 30;

const log = (...args: unknown[]) => console.error('[api/doc-answer]', ...args);

interface Chunk {
  page: number;
  content: string;
}

// POST /api/doc-answer
// Synthesizes a plain-language answer to a document question from the retrieved
// chunks (retrieval happens on the Render backend). Primary: Anthropic Claude
// (claude-sonnet-4-6). If ANTHROPIC_API_KEY is missing or the call fails, it
// degrades to a concise extract of the ACTUAL retrieved passages (never sample
// data) and says so via `notice`.
export async function POST(req: Request) {
  let body: { question?: string; fileName?: string; chunks?: Chunk[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });
  }

  const { question, fileName, chunks } = body;
  if (!question?.trim() || !Array.isArray(chunks) || !chunks.length) {
    return NextResponse.json({
      answer: 'I could not find anything relevant in the document for that question.',
      citations: [],
    });
  }

  const pages = [...new Set(chunks.map((c) => c.page))].sort((a, b) => a - b);
  const citations = pages.map((page) => ({ page }));
  const extract = (n: number) =>
    chunks.slice(0, n).map((c) => c.content.replace(/\s+/g, ' ').trim()).join(' ');

  // Clear degraded state when the AI provider is not configured — no silent
  // failure, no sample data: a concise extract of the real passages + notice.
  if (!isAnthropicConfigured()) {
    return NextResponse.json({
      answer: extract(3),
      citations,
      source: 'extract',
      notice: 'AI answer synthesis is not configured (ANTHROPIC_API_KEY missing) — showing an extract of the matching passages.',
    });
  }

  const context = chunks
    .map((c, i) => `[${i + 1}] (page ${c.page}) ${c.content}`)
    .join('\n\n');

  const system = [
    `You are answering a question about the document "${fileName ?? 'the document'}".`,
    'Write a clear, direct answer IN YOUR OWN WORDS using ONLY the information in',
    'the numbered passages below. Do NOT just repeat or list the passages. Produce',
    'a short, readable answer (a sentence or short paragraph). Some passages may be',
    'irrelevant — ignore any that do not help answer the question. If the passages',
    'do not contain the answer, say you could not find it in the document. Do not',
    'invent anything. Do not include page numbers in your text (they are shown',
    'separately as sources).',
    '',
    `PASSAGES:\n${context}`,
  ].join('\n');

  try {
    const answer = await answerWithClaude({
      system,
      messages: [{ role: 'user', content: question }],
      maxTokens: 1024,
    });
    if (!answer) {
      return NextResponse.json({ answer: extract(2), citations, source: 'extract' });
    }
    return NextResponse.json({ answer, citations, source: 'claude', model: CHAT_MODEL });
  } catch (err) {
    log(`Claude doc-answer failed: ${(err as Error).message}`);
    return NextResponse.json({
      answer: extract(2),
      citations,
      source: 'extract',
      notice: 'AI answer synthesis is temporarily unavailable — showing an extract of the matching passages.',
    });
  }
}
