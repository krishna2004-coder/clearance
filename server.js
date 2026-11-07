import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, ROOT } from './lib/env.js';
import { generateGuide } from './lib/agent.js';
import { llmFromKey } from './lib/llm.js';
import { toMarkdown } from './lib/markdown.js';
import { catalog, findToolkit, slugify } from './lib/catalog.js';
import { RUBRIC, LEVELS, FACTOR_LABELS } from './lib/score.js';

const PUBLIC = path.join(ROOT, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon' };
const SPA_ROUTES = [/^\/$/, /^\/guide\/[a-z0-9-]+\/?$/, /^\/generate\/?$/, /^\/how-it-works\/?$/];
const DIRS = [...new Set([config.generatedDir, config.libraryDir])]; // generated first: a re-run overrides the library copy
// On serverless hosts data/guides isn't on disk; use the bundled copy (scripts/bundle-data.js).
const BUNDLED = fs.existsSync(config.libraryDir) ? null : (await import('./lib/data.generated.js')).library;

function loadGuide(slug) {
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  for (const d of DIRS) {
    const f = path.join(d, `${slug}.json`);
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  }
  return BUNDLED?.[slug] || null;
}

function saveGuide(doc) {
  fs.mkdirSync(config.generatedDir, { recursive: true });
  fs.writeFileSync(path.join(config.generatedDir, `${doc.slug}.json`), JSON.stringify(doc, null, 2));
}

function allGuideDocs() {
  const docs = new Map();
  for (const d of DIRS) {
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d).filter((x) => x.endsWith('.json'))) {
      const slug = f.slice(0, -5);
      if (docs.has(slug)) continue;
      try {
        docs.set(slug, JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')));
      } catch {}
    }
  }
  for (const [slug, g] of Object.entries(BUNDLED || {})) if (!docs.has(slug)) docs.set(slug, g);
  return docs;
}

function listGuides() {
  const seen = new Map();
  for (const [slug, g] of allGuideDocs()) {
    {
      try {
        seen.set(slug, {
          slug: g.slug,
          name: g.app.name,
          provider: g.app.provider,
          category: g.app.category,
          website: g.app.website,
          one_liner: g.app.one_liner,
          level: g.score.level,
          label: g.score.label,
          total: g.score.total,
          production_review: g.factors.production_review.value,
          wait: [g.factors.review_wait.min_days, g.factors.review_wait.max_days],
          production_days: [g.effort.production_days_min, g.effort.production_days_max],
          first_test_minutes: g.effort.time_to_first_test_minutes,
          confidence: g.confidence.level,
          composio: g.composio,
          generated_at: g.generated_at,
          origin: g.origin || 'library',
        });
      } catch {}
    }
  }
  return [...seen.values()].sort((a, b) => a.level - b.level || a.total - b.total || a.name.localeCompare(b.name));
}

const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

function readBody(req, limit = 4096) {
  return new Promise((resolve) => {
    if (req.body !== undefined) {
      // Vercel's Node runtime buffers and exposes the body; plain Node leaves it undefined.
      const b = req.body;
      if (typeof b === 'string' || Buffer.isBuffer(b)) {
        try {
          return resolve(JSON.parse(String(b) || '{}'));
        } catch {
          return resolve({});
        }
      }
      return resolve(b || {});
    }
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > limit) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

// ---- Live generation: one run per slug, any number of viewers ----
const inflight = new Map(); // slug -> { events: [], clients: Set<res> }
const ipHits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const hits = (ipHits.get(ip) || []).filter((t) => now - t < 3600_000);
  ipHits.set(ip, hits);
  if (hits.length >= Number(process.env.GEN_PER_HOUR || 20)) return true;
  hits.push(now);
  return false;
}
const sse = (res, event) => res.write(`data: ${JSON.stringify(event)}\n\n`);

async function handleGenerate(req, res, url) {
  // POST {app, force, key}: the visitor's key is used for this run only and never stored or logged.
  const body = req.method === 'POST' ? await readBody(req) : {};
  const app = String(body.app || url.searchParams.get('app') || '').trim().slice(0, 120);
  const force = body.force === true || url.searchParams.get('force') === '1';
  const llm = llmFromKey(body.key) || config.llm;
  if (!app) return json(res, 400, { error: 'Missing app' });
  const toolkit = findToolkit(app);
  const slug = toolkit?.slug || slugify(app);

  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  const stop = () => clearInterval(ping);
  req.on('close', () => {
    stop();
    inflight.get(slug)?.clients.delete(res);
  });

  if (!force && loadGuide(slug)) {
    sse(res, { type: 'exists', slug });
    stop();
    return res.end();
  }
  let run = inflight.get(slug);
  if (run) {
    run.events.forEach((e) => sse(res, e));
    run.clients.add(res);
    return run.promise.finally(stop);
  }
  const fail = (message) => {
    sse(res, { type: 'error', message });
    stop();
    res.end();
  };
  if (!llm) return fail('No API key. Paste your OpenAI or OpenRouter key above to run the agent.');
  if (inflight.size >= config.maxConcurrentGenerations) return fail('The agent is busy with other guides. Try again in a minute.');
  if (rateLimited(req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress)) return fail('Hourly generation limit reached for this demo.');

  run = { events: [], clients: new Set([res]) };
  inflight.set(slug, run);
  const emit = (e) => {
    const ev = { ...e, t: Date.now() };
    run.events.push(ev);
    for (const c of run.clients) sse(c, ev);
  };
  emit({ type: 'start', slug, app });
  run.promise = generateGuide(app, emit, { slug, llm })
    .then((doc) => {
      doc.origin = 'generated';
      try {
        saveGuide(doc);
      } catch (e) {
        console.error('save failed', e.message);
      }
      // Ship the guide with the event: on serverless hosts the next request may hit another instance.
      emit({ type: 'done', slug, seconds: doc.generation_seconds, guide: doc, markdown: toMarkdown(doc) });
    })
    .catch((e) => emit({ type: 'error', message: e.message }))
    .finally(() => {
      inflight.delete(slug);
      stop();
      for (const c of run.clients) c.end();
    });
  return run.promise;
}

function serveStatic(res, pathname) {
  const file = path.normalize(path.join(PUBLIC, pathname));
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
  return true;
}

export async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  try {
    if (p === '/api/config') return json(res, 200, { server_key: !!config.llm, provider: config.llm?.provider || null });
    if (p === '/api/guides') return json(res, 200, { guides: listGuides(), catalog: { oauth_apps: catalog.length, managed: catalog.filter((t) => t.managed).length } });
    let m = p.match(/^\/api\/guides\/([a-z0-9-]+)\.md$/);
    if (m) {
      const g = loadGuide(m[1]);
      if (!g) return json(res, 404, { error: 'Guide not found' });
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': `inline; filename="${g.slug}-oauth-guide.md"` });
      return res.end(toMarkdown(g, `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`));
    }
    m = p.match(/^\/api\/guides\/([a-z0-9-]+)$/);
    if (m) {
      const g = loadGuide(m[1]);
      return g ? json(res, 200, g) : json(res, 404, { error: 'Guide not found' });
    }
    if (p === '/api/catalog') {
      const q = (url.searchParams.get('q') || '').toLowerCase().trim();
      const have = new Set(listGuides().map((g) => g.slug));
      const hits = q ? catalog.filter((t) => t.name.toLowerCase().includes(q) || t.slug.includes(q)).sort((a, b) => (a.name.toLowerCase().startsWith(q) ? -1 : 0) - (b.name.toLowerCase().startsWith(q) ? -1 : 0) || b.toolCount - a.toolCount).slice(0, 8) : [];
      return json(res, 200, { results: hits.map((t) => ({ slug: t.slug, name: t.name, logo: t.logo, category: t.category, managed: t.managed, has_guide: have.has(t.slug) })) });
    }
    if (p === '/api/rubric') return json(res, 200, { rubric: RUBRIC, levels: LEVELS.map((l) => ({ ...l, max: l.max === Infinity ? null : l.max })), labels: FACTOR_LABELS });
    if (p === '/api/generate') return await handleGenerate(req, res, url);
    if (SPA_ROUTES.some((r) => r.test(p))) {
      if (serveStatic(res, '/index.html')) return;
      // Serverless bundle has no public/ on disk: serve the bundled shell so the route never hangs.
      const shell = (await import('./lib/data.generated.js')).indexHtml;
      res.writeHead(shell ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(shell || 'Not found');
    }
    if (serveStatic(res, p)) return;
    json(res, 404, { error: 'Not found' });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, 500, { error: 'Server error' });
    else res.end();
  }
}

// Vercel auto-detects server.js as the entry point and calls its default export (static files in public/ are served by Vercel directly).
export default handler;

// Run as a normal server locally.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  http.createServer(handler).listen(config.port, () => console.log(`Clearance running on http://localhost:${config.port}`));
}
