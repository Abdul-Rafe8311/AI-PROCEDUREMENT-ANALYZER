'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Send, Sparkles, User, Bot, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import type { ChatAnswer } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';

interface Message {
  role: 'user' | 'assistant';
  text: string;
  sources?: ChatAnswer['sources'];
}

const SUGGESTIONS = [
  'Which supplier has the lowest total cost?',
  'Show suppliers delivering within 14 days.',
  'Which quotation has the best payment terms?',
];

export function ChatTab({ requestId }: { requestId: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');

  const ask = useMutation({
    mutationFn: (question: string) =>
      api.post<ChatAnswer>(`/requests/${requestId}/chat`, { question }),
    onSuccess: (res) =>
      setMessages((m) => [...m, { role: 'assistant', text: res.answer, sources: res.sources }]),
    onError: (e) =>
      setMessages((m) => [...m, { role: 'assistant', text: `Error: ${(e as Error).message}` }]),
  });

  function send(question: string) {
    if (!question.trim()) return;
    setMessages((m) => [...m, { role: 'user', text: question }]);
    setInput('');
    ask.mutate(question);
  }

  return (
    <Card className="flex h-[600px] flex-col">
      <CardContent className="flex flex-1 flex-col gap-4 overflow-hidden p-5">
        <div className="flex-1 space-y-4 overflow-y-auto pr-2">
          {messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center text-center text-muted-foreground">
              <Sparkles className="mb-3 h-10 w-10 text-primary" />
              <p className="font-medium text-foreground">Ask about these quotations</p>
              <p className="mb-4 text-sm">RAG-powered answers grounded in your uploaded documents.</p>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-full border px-3 py-1.5 text-xs hover:bg-accent"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                {m.role === 'user' ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
              </div>
              <div className={`max-w-[75%] rounded-lg px-4 py-2 text-sm ${m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                <p className="whitespace-pre-wrap">{m.text}</p>
                {m.sources && m.sources.length > 0 && (
                  <div className="mt-2 space-y-1 border-t border-border/50 pt-2">
                    <p className="text-xs font-medium opacity-70">Sources:</p>
                    {m.sources.map((s, j) => (
                      <p key={j} className="text-xs opacity-70">
                        • {s.supplierName ?? 'Unknown'}: {s.snippet.slice(0, 90)}…
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {ask.isPending && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Thinking…
            </div>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="flex gap-2"
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question about these quotations…"
            disabled={ask.isPending}
          />
          <Button type="submit" size="icon" disabled={ask.isPending || !input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
