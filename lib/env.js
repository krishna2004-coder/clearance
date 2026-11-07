import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Minimal .env loader (no dependencies). Real env vars win over the file.
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const useOpenRouter = !!process.env.OPENROUTER_API_KEY;
const serverKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || '';
const onVercel = !!process.env.VERCEL;

export const config = {
  port: Number(process.env.PORT || 3344),
  // Optional server-side key. The hosted demo has none: visitors paste their own key per run.
  llm: serverKey
    ? { provider: useOpenRouter ? 'openrouter' : 'openai', baseUrl: useOpenRouter ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1', apiKey: serverKey }
    : null,
  // Model ids use OpenRouter naming; the "openai/" prefix is stripped for direct OpenAI use.
  researchModel: process.env.RESEARCH_MODEL || 'openai/gpt-5.5',
  writerModel: process.env.WRITER_MODEL || 'openai/gpt-5.5',
  // Web search: OpenRouter web plugin on a small model, or OpenAI's search model.
  searchModel: { openrouter: process.env.SEARCH_MODEL || 'openai/gpt-5.4-mini', openai: process.env.OPENAI_SEARCH_MODEL || 'gpt-5-search-api' },
  webSearch: process.env.WEB_SEARCH || 'on',
  onVercel,
  // Library guides ship read-only; live-generated guides go to a writable dir (/tmp on Vercel).
  libraryDir: path.join(ROOT, 'data', 'guides'),
  generatedDir: onVercel ? '/tmp/clearance-guides' : path.join(ROOT, 'data', 'guides'),
  maxConcurrentGenerations: Number(process.env.MAX_CONCURRENT || 3),
  guidesDir: path.join(ROOT, 'data', 'guides'),
};
