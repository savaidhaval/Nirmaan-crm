// core/ai.js — the one place that talks to the AI model (Cloudflare Workers AI, free daily allowance).
// The model gets only text we build, has no tools and cannot read or change the database. Everything it returns is shown to a person to check.

export const DEFAULT_MODEL = '@cf/meta/llama-3.1-8b-instruct';

export class AiError extends Error {}

// Test mode (AI_MOCK is set only in .dev.vars / CI, never in production): echoes the facts back so tests are deterministic.
function mockReply(messages) {
  const user = messages.filter((m) => m.role === 'user').pop();
  const text = user ? user.content : '';
  const facts = text.includes('FACTS:') ? text.split('FACTS:')[1].trim().split('\n').slice(0, 6).join(' ') : text.slice(0, 200);
  return `MOCK REPLY. ${facts}`.slice(0, 600);
}

export async function runModel(env, getSetting, messages, { maxTokens = 400 } = {}) {
  if (env.AI_MOCK) return { text: mockReply(messages), model: 'mock' };
  if (!env.AI) throw new AiError('The AI is not connected on this server yet. The Owner can check this under More → Settings.');
  const model = String((await getSetting(env, 'ai.model')) || DEFAULT_MODEL);
  try {
    const r = await env.AI.run(model, { messages, max_tokens: maxTokens, temperature: 0.2 });
    const text = String((r && (r.response || (r.result && r.result.response))) || '').trim();
    if (!text) throw new AiError('The AI sent back an empty answer. Please try again.');
    return { text, model };
  } catch (e) {
    if (e instanceof AiError) throw e;
    const msg = String((e && e.message) || e);
    console.error('[ai] model error', msg.slice(0, 300));
    if (/neurons|quota|limit|429|capacity/i.test(msg)) throw new AiError('Today\'s free AI allowance is used up. It starts again tomorrow.');
    if (/no such model|not found|model/i.test(msg)) throw new AiError('The AI model name in Settings is not available. Ask the Owner to check "AI model".');
    throw new AiError('The AI is busy right now. Please try again in a minute.');
  }
}
