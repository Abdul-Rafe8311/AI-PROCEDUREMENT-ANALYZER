// Groq chat-completions client for text-layer document extraction.
//
// Root cause of the July 27 incident ("three of five suppliers extracted
// empty"): the account's Groq key is on the free on-demand tier, capped at
// 12,000 tokens/minute for llama-3.3-70b-versatile. The extraction system
// prompt alone runs ~3,400 tokens, so a batch of several documents run back
// to back blows through the budget after ~2 calls and the rest come back
// HTTP 429 — which the old fallback code turned straight into an empty
// extraction. This client SERIALIZES calls (never more than one in flight)
// and retries a 429 after the wait time Groq itself reports, so a batch just
// runs slower instead of silently dropping documents.
//
// Server-only: reads GROQ_API_KEY from the environment.

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MAX_RETRIES = 4;

export const isGroqConfigured = (): boolean => !!process.env.GROQ_API_KEY;
export const groqModel = (): string => process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

export interface GroqReply {
  content: string | null;
  error: string | null;
  finishReason: string | null;
  usage: { promptTokens: number; completionTokens: number } | null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Extracts the wait time Groq reports in a 429 body, e.g.
// "Please try again in 9.08s" — falls back to exponential backoff if absent.
function retryDelayMs(body: string, attempt: number): number {
  const match = body.match(/try again in ([\d.]+)s/i);
  if (match) return Math.ceil(parseFloat(match[1]) * 1000) + 250;
  return Math.min(1000 * 2 ** attempt, 8000);
}

// Module-wide chain — every Groq call waits for the previous one to finish,
// so at most one request is in flight regardless of how many documents a
// batch upload is processing concurrently.
let queue: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn) as Promise<T>;
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function callGroqExtraction(
  system: string,
  user: string,
  maxTokens = 8192,
): Promise<GroqReply> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return { content: null, error: 'GROQ_API_KEY is not configured.', finishReason: null, usage: null };

  return serialize(async () => {
    const model = groqModel();
    let lastError = '';
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const started = Date.now();
      let res: Response;
      try {
        res = await fetch(GROQ_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            temperature: 0,
            max_tokens: maxTokens,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
          }),
        });
      } catch (err) {
        lastError = `Groq request failed: ${(err as Error).message}`;
        console.log(`[groq] attempt ${attempt + 1}/${MAX_RETRIES + 1} network error: ${lastError}`);
        if (attempt === MAX_RETRIES) break;
        await sleep(Math.min(1000 * 2 ** attempt, 8000));
        continue;
      }
      const elapsedMs = Date.now() - started;

      if (res.status === 429) {
        const body = await res.text().catch(() => '');
        const delay = retryDelayMs(body, attempt);
        console.log(
          `[groq] attempt ${attempt + 1}/${MAX_RETRIES + 1} rate-limited (model "${model}") — retrying in ${delay}ms`,
        );
        lastError = `Groq rate limit: ${body.slice(0, 300)}`;
        if (attempt === MAX_RETRIES) break;
        await sleep(delay);
        continue;
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        lastError = `Groq HTTP ${res.status} (model "${model}"): ${body.slice(0, 300)}`;
        console.log(`[groq] attempt ${attempt + 1}/${MAX_RETRIES + 1} failed: ${lastError}`);
        // Only 429/5xx are worth retrying — 4xx like bad request/auth won't fix itself.
        if (attempt === MAX_RETRIES || res.status < 500) break;
        await sleep(Math.min(1000 * 2 ** attempt, 8000));
        continue;
      }

      const json = (await res.json()) as {
        choices?: { message?: { content?: string }; finish_reason?: string }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const choice = json.choices?.[0];
      const content = choice?.message?.content ?? '';
      const finishReason = choice?.finish_reason ?? null;
      const usage = json.usage
        ? { promptTokens: json.usage.prompt_tokens ?? 0, completionTokens: json.usage.completion_tokens ?? 0 }
        : null;
      console.log(
        `[groq] model=${model} attempt=${attempt + 1} elapsed=${elapsedMs}ms finish_reason=${finishReason} ` +
          `tokens=${usage ? `${usage.promptTokens}+${usage.completionTokens}` : 'n/a'} content_len=${content.length}`,
      );
      if (finishReason === 'length') {
        console.log(`[groq] reply was TRUNCATED by max_tokens (${maxTokens}) — content is likely unparseable JSON.`);
      }
      if (!content) return { content: null, error: 'Groq returned an empty extraction response.', finishReason, usage };
      return { content, error: null, finishReason, usage };
    }
    return { content: null, error: lastError || 'Groq extraction failed after retries.', finishReason: null, usage: null };
  });
}
