import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

interface Chunk {
  page: number;
  content: string;
}

// POST /api/doc-answer
// Synthesizes a plain-language answer to a document question from the
// retrieved chunks (retrieval happens on the Render backend). Uses Groq.
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

  const provider = resolveProvider();
  if (!provider) {
    // No LLM key: return a concise extract rather than a raw dump.
    const answer = chunks
      .slice(0, 3)
      .map((c) => c.content.replace(/\s+/g, ' ').trim())
      .join(' ');
    return NextResponse.json({ answer, citations, source: 'extract' });
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
    const res = await fetch(provider.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.apiKey}` },
      body: JSON.stringify({
        model: provider.model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: question },
        ],
      }),
    });
    if (!res.ok) {
      const answer = chunks.slice(0, 2).map((c) => c.content.trim()).join(' ');
      return NextResponse.json({ answer, citations, source: 'extract' });
    }
    const data = await res.json();
    const answer: string =
      data?.choices?.[0]?.message?.content?.trim() ||
      chunks.slice(0, 2).map((c) => c.content.trim()).join(' ');
    return NextResponse.json({ answer, citations, source: provider.name });
  } catch {
    const answer = chunks.slice(0, 2).map((c) => c.content.trim()).join(' ');
    return NextResponse.json({ answer, citations, source: 'extract' });
  }
}

function resolveProvider() {
  const groq = process.env.GROQ_API_KEY;
  if (groq)
    return {
      name: 'groq',
      apiKey: groq,
      url: 'https://api.groq.com/openai/v1/chat/completions',
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    };
  const openai = process.env.OPENAI_API_KEY;
  if (openai)
    return {
      name: 'openai',
      apiKey: openai,
      url: 'https://api.openai.com/v1/chat/completions',
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    };
  return null;
}
