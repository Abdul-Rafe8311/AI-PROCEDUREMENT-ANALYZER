'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, MessageSquare, SendHorizonal, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ChatMessage } from '@/lib/workspace-types';

const SUGGESTIONS = [
  'Which supplier is cheapest?',
  'Compare payment terms.',
  'Which supplier has the lowest steel price?',
];

export function ChatPanel({
  messages,
  onSend,
  sending,
  disabled,
}: {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  sending: boolean;
  disabled: boolean;
}) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  const submit = (text: string) => {
    const value = text.trim();
    if (!value || sending || disabled) return;
    onSend(value);
    setInput('');
  };

  return (
    <div className="flex flex-col rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex items-center gap-2 border-b border-border px-5 py-4 text-sm font-semibold">
        <MessageSquare className="h-4 w-4 text-primary" />
        Chat with your quotations
      </div>

      <div ref={scrollRef} className="max-h-[26rem] min-h-[12rem] overflow-y-auto px-5 py-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center py-8 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Sparkles className="h-5 w-5" />
            </span>
            <p className="mt-3 text-sm font-medium">Ask anything about these suppliers</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {disabled ? 'Analyze quotations first to start chatting.' : 'Try one of these:'}
            </p>
            {!disabled && (
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => submit(s)}
                    className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((m) => (
              <div
                key={m.id}
                className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}
              >
                <div
                  className={cn(
                    'max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
                    m.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'border border-border bg-muted/50 text-foreground',
                  )}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-2xl border border-border bg-muted/50 px-4 py-2.5 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Thinking…
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
        className="flex items-center gap-2 border-t border-border p-3"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={disabled || sending}
          placeholder={disabled ? 'Analyze quotations to begin…' : 'Ask about cost, delivery, terms…'}
          className="flex-1 rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={disabled || sending || !input.trim()}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Send message"
        >
          <SendHorizonal className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
