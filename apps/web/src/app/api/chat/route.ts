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

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ answer: answerFromData(question, analysis), source: 'rules' });
  }

  try {
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    const system = [
      'You are a procurement analyst assistant. Answer concisely and only from the',
      'supplier quotation data provided as JSON. Use figures from the data. If asked',
      'something the data cannot answer, say so briefly.',
      '',
      `QUOTATION DATA:\n${JSON.stringify(analysis, null, 2)}`,
    ].join('\n');

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
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
    return NextResponse.json({ answer, source: 'openai' });
  } catch {
    return NextResponse.json({ answer: answerFromData(question, analysis), source: 'rules' });
  }
}
