import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './env.js';

// Composio's public OAuth toolkit catalog (402 apps), snapshotted from docs.composio.dev/data/toolkits.json.
// Read from data/ when present (local dev); fall back to the bundled module on serverless hosts.
const catalogFile = path.join(ROOT, 'data', 'composio-oauth-toolkits.json');
export const catalog = fs.existsSync(catalogFile) ? JSON.parse(fs.readFileSync(catalogFile, 'utf8')) : (await import('./data.generated.js')).catalog;

const norm = (s) => String(s || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[^a-z0-9]/g, '');

export function slugify(input) {
  let s = String(input || '').trim().toLowerCase();
  try {
    if (/^https?:\/\//.test(s) || /\.[a-z]{2,}(\/|$)/.test(s)) {
      const host = new URL(/^https?:/.test(s) ? s : `https://${s}`).hostname.replace(/^www\./, '');
      const parts = host.split('.');
      s = parts.length > 2 && ['app', 'api', 'developer', 'developers', 'docs'].includes(parts[0]) ? parts[1] : parts[0];
    }
  } catch {}
  return s.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'app';
}

export function findToolkit(nameOrSlug) {
  const n = norm(nameOrSlug);
  if (!n) return null;
  return catalog.find((t) => norm(t.slug) === n) || catalog.find((t) => norm(t.name) === n) || null;
}

export function composioStatus(appName, slug) {
  const t = findToolkit(slug) || findToolkit(appName);
  if (!t) return { in_catalog: false, managed: false, toolkit: null };
  return { in_catalog: true, managed: t.managed, toolkit: t.slug, name: t.name, logo: t.logo, tool_count: t.toolCount };
}
