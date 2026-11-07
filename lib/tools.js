import dns from 'node:dns/promises';
import net from 'node:net';

const UA = 'ClearanceBot/1.0 (OAuth setup guide research; +https://github.com/)';

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:127.') || v.startsWith('::ffff:10.') || v.startsWith('::ffff:192.168.');
}

// SSRF guard: model-chosen URLs must be public http(s) hosts.
export async function assertPublicUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('invalid URL');
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error('only http(s) URLs are allowed');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('private host blocked');
  const ips = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((r) => r.address);
  if (ips.some(isPrivateIp)) throw new Error('private address blocked');
  return u;
}

export async function safeFetch(url, { method = 'GET', headers = {}, body, timeoutMs = 10_000, redirect = 'follow' } = {}) {
  await assertPublicUrl(url);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { method, headers: { 'User-Agent': UA, Accept: '*/*', ...headers }, body, redirect, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<(nav|footer|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

// Tool exposed to the research model: read a documentation page.
export async function fetchPage(url, maxChars = 14_000) {
  try {
    const res = await safeFetch(url, { headers: { Accept: 'text/html,application/json,text/plain' } });
    const type = res.headers.get('content-type') || '';
    const raw = await res.text();
    const title = (raw.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1]?.trim() || '';
    const text = type.includes('html') ? htmlToText(raw) : raw;
    return { ok: res.ok, status: res.status, final_url: res.url, title, text: text.slice(0, maxChars), truncated: text.length > maxChars };
  } catch (e) {
    return { ok: false, status: 0, error: String(e.message || e) };
  }
}

const snippet = (s, n = 220) => (s || '').replace(/\s+/g, ' ').trim().slice(0, n);

// ---------- Deterministic probes: things we actually test, not just read ----------

async function probeDiscovery(urls) {
  for (const url of urls) {
    try {
      const res = await safeFetch(url, { headers: { Accept: 'application/json' }, timeoutMs: 8000 });
      if (!res.ok) continue;
      const meta = await res.json().catch(() => null);
      if (!meta || !meta.authorization_endpoint) continue;
      return {
        kind: 'discovery',
        target: url,
        ok: true,
        summary: `Metadata published. PKCE methods: ${(meta.code_challenge_methods_supported || ['not advertised']).join(', ')}.`,
        data: {
          issuer: meta.issuer,
          authorization_endpoint: meta.authorization_endpoint,
          token_endpoint: meta.token_endpoint,
          code_challenge_methods_supported: meta.code_challenge_methods_supported || null,
          grant_types_supported: meta.grant_types_supported || null,
          scopes_supported_count: Array.isArray(meta.scopes_supported) ? meta.scopes_supported.length : null,
        },
      };
    } catch {}
  }
  return { kind: 'discovery', target: urls[0] || 'n/a', ok: false, summary: 'No OIDC/OAuth metadata document found at standard locations.' };
}

async function probeAuthorize(authorizeUrl) {
  const u = new URL(authorizeUrl);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', 'clearance-probe-invalid-client');
  u.searchParams.set('redirect_uri', 'https://example.com/oauth/callback');
  u.searchParams.set('state', 'clearance-probe');
  try {
    const res = await safeFetch(u.toString(), { redirect: 'manual', headers: { Accept: 'text/html' } });
    const loc = res.headers.get('location') || '';
    const body = res.status >= 300 && res.status < 400 ? '' : await res.text().catch(() => '');
    const live = res.status < 500;
    let behavior = `HTTP ${res.status}`;
    if (loc) behavior += ` → redirects to ${new URL(loc, u).host}${new URL(loc, u).pathname}`;
    const err = (loc.match(/error=([^&]+)/) || body.match(/(invalid_client|invalid_request|unauthorized_client|client_id)/i) || [])[1];
    if (err) behavior += ` (mentions "${decodeURIComponent(err)}")`;
    return { kind: 'authorize_endpoint', target: authorizeUrl, ok: live, summary: live ? `Endpoint is live and handles an unregistered client: ${behavior}.` : `Endpoint error: ${behavior}.`, data: { status: res.status, location: loc ? snippet(loc, 160) : null, body_excerpt: snippet(htmlToText(body), 160) || null } };
  } catch (e) {
    return { kind: 'authorize_endpoint', target: authorizeUrl, ok: false, summary: `Could not reach endpoint: ${e.message}` };
  }
}

async function probeToken(tokenUrl) {
  try {
    const res = await safeFetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: 'clearance-probe', redirect_uri: 'https://example.com/oauth/callback', client_id: 'clearance-probe-invalid-client', client_secret: 'invalid' }).toString(),
      redirect: 'manual',
    });
    const text = await res.text().catch(() => '');
    let errCode = null;
    try {
      const j = JSON.parse(text);
      errCode = j.error || j.error_description || j.message || null;
      if (typeof errCode === 'object') errCode = JSON.stringify(errCode).slice(0, 80);
    } catch {
      errCode = (text.match(/(invalid_client|invalid_grant|invalid_request|unauthorized)/i) || [])[1] || null;
    }
    const live = res.status >= 200 && res.status < 500;
    return {
      kind: 'token_endpoint',
      target: tokenUrl,
      ok: live,
      summary: live ? `Token endpoint is live and rejects fake credentials: HTTP ${res.status}${errCode ? ` "${errCode}"` : ''}.` : `Token endpoint returned HTTP ${res.status}.`,
      data: { status: res.status, error: errCode, body_excerpt: snippet(text, 160) },
    };
  } catch (e) {
    return { kind: 'token_endpoint', target: tokenUrl, ok: false, summary: `Could not reach endpoint: ${e.message}` };
  }
}

async function probePortal(portalUrl) {
  try {
    const res = await safeFetch(portalUrl, { headers: { Accept: 'text/html' } });
    const final = new URL(res.url);
    const signIn = /log-?in|sign-?in|auth|account|sso|identity/i.test(final.host + final.pathname) && final.href !== portalUrl;
    return {
      kind: 'developer_portal',
      target: portalUrl,
      ok: res.status < 500,
      summary: signIn ? `Portal is reachable and redirects to a sign-in page (${final.host}). You need a provider account to create the app.` : `Portal is reachable (HTTP ${res.status}).`,
      data: { status: res.status, final_url: res.url },
    };
  } catch (e) {
    return { kind: 'developer_portal', target: portalUrl, ok: false, summary: `Could not reach portal: ${e.message}` };
  }
}

// Tenant-specific endpoints (e.g. https://{MyDomain}.my.salesforce.com/...) can't be probed generically.
function probeable(u) {
  if (!u) return null;
  if (/[{}<>]|\byour[-_]?(domain|instance|tenant|shop|store)\b/i.test(u)) return false;
  try {
    return /^https?:$/.test(new URL(u).protocol);
  } catch {
    return false;
  }
}

export async function runProbes(endpoints) {
  const jobs = [];
  const skipped = [];
  const ep = { ...endpoints };
  for (const k of ['authorize_url', 'token_url', 'discovery_url', 'developer_portal_url']) {
    if (probeable(ep[k]) === false) {
      const templated = /[{}<>]|\byour[-_]?(domain|instance|tenant|shop|store)\b/i.test(ep[k]);
      skipped.push({
        kind: k.replace(/_url$/, '').replace('authorize', 'authorize_endpoint').replace(/^token$/, 'token_endpoint'),
        target: ep[k],
        ok: false,
        summary: templated ? 'Not probed: the URL is tenant- or customer-specific, so it only exists once a customer instance is known.' : 'Not probed: research did not find a valid URL for this endpoint.',
      });
      ep[k] = null;
    }
  }
  const { authorize_url, token_url, discovery_url, developer_portal_url } = ep;
  const discoveryCandidates = [];
  if (discovery_url) discoveryCandidates.push(discovery_url);
  for (const base of [authorize_url, token_url]) {
    if (!base) continue;
    try {
      const o = new URL(base).origin;
      discoveryCandidates.push(`${o}/.well-known/openid-configuration`, `${o}/.well-known/oauth-authorization-server`);
    } catch {}
  }
  if (discoveryCandidates.length) jobs.push(probeDiscovery([...new Set(discoveryCandidates)]));
  if (authorize_url) jobs.push(probeAuthorize(authorize_url));
  if (token_url) jobs.push(probeToken(token_url));
  if (developer_portal_url) jobs.push(probePortal(developer_portal_url));
  const results = await Promise.all(jobs.map((p) => p.catch((e) => ({ kind: 'error', ok: false, summary: `Probe failed: ${e.message || e}` }))));
  return [...results, ...skipped].map((r, i) => ({ id: `P${i + 1}`, ...r, at: new Date().toISOString() }));
}

// Check every cited source actually resolves. Bot walls are reported honestly, not as broken.
export async function checkSources(sources) {
  await Promise.all(
    sources.map(async (s) => {
      try {
        const res = await safeFetch(s.url, { headers: { Accept: 'text/html' }, timeoutMs: 8000 });
        s.http_status = res.status;
        s.reachable = res.ok ? 'yes' : [401, 403, 429, 999].includes(res.status) ? 'bot_blocked' : 'broken';
        res.body?.cancel?.();
      } catch {
        s.reachable = 'unreachable';
        s.http_status = 0;
      }
    })
  );
  return sources;
}
