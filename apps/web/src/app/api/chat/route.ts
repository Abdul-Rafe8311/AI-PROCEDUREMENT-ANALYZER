import { NextResponse } from 'next/server';
import { answerFromData } from '@/lib/analysis-engine';
import type { AnalysisResult, ChatMessage } from '@/lib/workspace-types';

export const runtime = 'nodejs';

interface ChatBody {
  question: string;
  analysis: AnalysisResult;
  history?: Pick<ChatMessage, 'role' | 'content'>[];
}

// POST /api/chat — answers questions about the analyzed quotations.
// Uses OpenAI when OPENAI_API_KEY is set; otherwise a rule-based responder
// that computes real answers from the comparison data.
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

  // Prefer Groq (OpenAI-compatible), then OpenAI, else rule-based answers.
  const provider = resolveProvider();
  if (!provider) {
    return NextResponse.json({ answer: answerFromData(question, analysis), source: 'rules' });
  }

  try {
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

    const res = await fetch(provider.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model: provider.model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: system },
          ...history.slice(-6).map((m) => ({ role: m.role, content: m.content })),
          { role: 'user', content: question },
        ],
      }),
    });

    if (!res.ok) {
      // Fall back to deterministic answer on any API error.
      return NextResponse.json({ answer: answerFromData(question, analysis), source: 'rules' });
    }

    const data = await res.json();
    const answer: string =
      data?.choices?.[0]?.message?.content?.trim() || answerFromData(question, analysis);
    return NextResponse.json({ answer, source: provider.name });
  } catch {
    return NextResponse.json({ answer: answerFromData(question, analysis), source: 'rules' });
  }
}

function resolveProvider():
  | { name: 'groq' | 'openai'; apiKey: string; url: string; model: string }
  | null {
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    return {
      name: 'groq',
      apiKey: groqKey,
      url: 'https://api.groq.com/openai/v1/chat/completions',
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    };
  }
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    return {
      name: 'openai',
      apiKey: openaiKey,
      url: 'https://api.openai.com/v1/chat/completions',
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    };
  }
  return null;
}
