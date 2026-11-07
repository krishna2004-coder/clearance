import { config } from './env.js';

// Resolve an LLM connection from a key. Keys starting with "sk-or-" are OpenRouter, others OpenAI.
export function llmFromKey(key) {
  const k = String(key || '').trim();
  if (!k) return null;
  const or = k.startsWith('sk-or-');
  return { provider: or ? 'openrouter' : 'openai', baseUrl: or ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1', apiKey: k };
}

// Model ids use OpenRouter naming ("openai/gpt-5.5"); map them for direct OpenAI use.
export function modelFor(llm, model) {
  return llm.provider === 'openai' ? model.replace(/^openai\//, '') : model;
}

// Provider-agnostic Chat Completions client with retries and clear, non-retried
// errors for bad keys and empty balances.
export async function chat(body, { llm = config.llm, timeoutMs = 240_000, retries = 2 } = {}) {
  if (!llm?.apiKey) throw Object.assign(new Error('No API key. Paste your OpenAI or OpenRouter key on the Generate page.'), { fatal: true });
  const payload = { ...body, model: modelFor(llm, body.model) };
  if (llm.provider === 'openrouter') payload.usage = { include: true };
  else {
    // OpenAI Chat Completions naming for GPT-5-family models.
    delete payload.plugins;
    if (payload.max_tokens) (payload.max_completion_tokens = payload.max_tokens), delete payload.max_tokens;
    if (payload.reasoning) (payload.reasoning_effort = payload.reasoning.effort), delete payload.reasoning;
  }
  const label = llm.provider === 'openrouter' ? 'OpenRouter' : 'OpenAI';
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${llm.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${llm.apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://clearance.app', 'X-Title': 'Clearance' },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      const json = await res.json().catch(() => ({}));
      const msg = json?.error?.message || '';
      if (res.ok && !json.error) return json;
      if (res.status === 401 || res.status === 403) throw Object.assign(new Error(`${label} rejected the API key (HTTP ${res.status}). Check the key and try again.`), { fatal: true });
      if (res.status === 402 || json?.error?.code === 402 || json?.error?.code === 'insufficient_quota' || /requires more credits|no credits|exceeded your current quota/i.test(msg)) {
        throw Object.assign(new Error(`The ${label} account for this API key is out of credits. Add credits to that account, then try again.`), { fatal: true });
      }
      lastErr = new Error(`${label} ${res.status}: ${msg || res.statusText}`);
      if (res.status !== 429 && res.status < 500) throw Object.assign(lastErr, { fatal: true });
    } catch (e) {
      if (e.fatal) throw e;
      lastErr = e.name === 'AbortError' ? new Error('LLM request timed out') : e;
    } finally {
      clearTimeout(timer);
    }
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  throw lastErr;
}

export const messageOf = (res) => res?.choices?.[0]?.message || {};

export function parseJson(text) {
  if (!text) throw new Error('empty model output');
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error('model did not return JSON');
  }
}

export const jsonFormat = (name, schema) => ({ type: 'json_schema', json_schema: { name, strict: true, schema } });

// Build an OpenAI strict-mode JSON schema object: every key required, no extras.
export const S = {
  obj: (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false }),
  arr: (items) => ({ type: 'array', items }),
  str: (description) => (description ? { type: 'string', description } : { type: 'string' }),
  nstr: (description) => ({ type: ['string', 'null'], ...(description ? { description } : {}) }),
  num: (description) => ({ type: ['number', 'null'], ...(description ? { description } : {}) }),
  bool: () => ({ type: 'boolean' }),
  enm: (values, description) => ({ type: 'string', enum: values, ...(description ? { description } : {}) }),
};
