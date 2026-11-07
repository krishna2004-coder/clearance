// Clearance front-end: vanilla JS, no build step.
const $app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? esc(u) : '#');
const api = (p) => fetch(p).then((r) => (r.ok ? r.json() : Promise.reject(r)));
const LEVEL_VAR = ['--l0', '--l1', '--l2', '--l3', '--l4', '--l5'];
const ICON = {
  search: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
  md: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 19h16"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  print: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V3h12v6M6 18H4v-7h16v7h-2"/><rect x="6" y="14" width="12" height="7"/></svg>',
  redo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>',
  spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/></svg>',
};

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 1800);
}
async function copy(text, msg = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast(msg);
}
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// ---------- formatting ----------
function fmtDays(min, max) {
  if (max == null && min == null) return 'Unknown';
  if (!max) return min ? `${min}+ days` : 'None';
  if (max < 1) return 'Same day';
  if (max >= 14) {
    const a = Math.max(1, Math.round((min || 0) / 7)), b = Math.round(max / 7);
    return a === b ? `~${b} weeks` : `${a}–${b} weeks`;
  }
  return min === max || !min ? `${min ? '' : 'up to '}${max} day${max > 1 ? 's' : ''}` : `${min}–${max} days`;
}
const fmtHours = (a, b) => (a == null && b == null ? '?' : a === b || b == null ? `${a} h` : `${a}–${b} h`);
const fmtMin = (m) => (m == null ? '?' : m < 60 ? `${m} min` : `${Math.round((m / 60) * 10) / 10} h`);
const REVIEW_TXT = { none: 'No review', optional_listing: 'Listing optional', required_for_some_scopes: 'Review for some scopes', required: 'Review required' };

function logo(g, cls = '') {
  const host = (() => { try { return new URL(g.website).hostname; } catch { return ''; } })();
  const src = g.composio?.logo || (host ? `https://www.google.com/s2/favicons?domain=${host}&sz=128` : '');
  const ph = `<span class='ph'>${esc((g.name || g.app?.name || '?')[0])}</span>`;
  return `<span class="logo ${cls}">${src ? `<img src="${esc(src)}" alt="" loading="lazy" onerror="this.outerHTML=&quot;${ph.replace(/"/g, '&quot;')}&quot;">` : ph}</span>`;
}
const levelPill = (level, label) => `<span class="pill l${level}"><span class="dot"></span>${esc(label)}</span>`;
function evChip(e) {
  if (!e) return '';
  if (e.type === 'inferred') return `<span class="ev inferred" title="Inferred: judgement from the research, not directly supported by a source or test">inferred</span>`;
  const refs = (e.refs || []).filter((r) => (e.type === 'tested' ? true : r.startsWith('S')));
  return refs.length
    ? refs.map((r) => `<button class="ev ${r.startsWith('P') ? 'tested' : 'sourced'}" data-ref="${esc(r)}" title="${r.startsWith('P') ? 'Confirmed by a live probe' : 'Supported by a cited source'}">${r.startsWith('P') ? '✓ ' : ''}${esc(r)}</button>`).join(' ')
    : `<span class="ev ${e.type}">${e.type}</span>`;
}
const ownerChip = (o) => `<span class="owner ${o}">${{ agent: '🤖 Agent', you: '🧑 You', provider: '⏳ Provider' }[o] || esc(o)}</span>`;

// ---------- router ----------
function navigate(path, replace = false) {
  if (replace) history.replaceState({}, '', path);
  else history.pushState({}, '', path);
  render();
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (a && !e.metaKey && !e.ctrlKey && a.origin === location.origin) {
    e.preventDefault();
    navigate(a.pathname + a.search);
  }
  const ref = e.target.closest('[data-ref]');
  if (ref) {
    const el = document.getElementById('ref-' + ref.dataset.ref);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.remove('flash');
      void el.offsetWidth;
      el.classList.add('flash');
    }
  }
});
window.addEventListener('popstate', render);

let activeStream = null;
async function render() {
  if (activeStream && !location.pathname.startsWith('/generate')) { activeStream.close(); activeStream = null; }
  const p = location.pathname;
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.pathname === p || (a.pathname !== '/' && p.startsWith(a.pathname))));
  window.scrollTo(0, 0);
  if (p === '/') return viewHome();
  if (p.startsWith('/guide/')) return viewGuide(p.split('/')[2]);
  if (p.startsWith('/generate')) return viewGenerate(new URLSearchParams(location.search).get('app') || '', new URLSearchParams(location.search).get('force') === '1');
  if (p.startsWith('/how-it-works')) return viewHow();
  $app.innerHTML = `<div class="empty">Page not found. <a href="/" data-link>Back to the library</a></div>`;
}

// ---------- search with autocomplete ----------
function mountSearch(root, guides) {
  const input = root.querySelector('input');
  const box = root.querySelector('.suggest');
  let items = [], sel = -1, timer;
  const go = (it) => (it.kind === 'guide' ? navigate(`/guide/${it.slug}`) : navigate(`/generate?app=${encodeURIComponent(it.app)}`));
  const draw = () => {
    box.innerHTML = items
      .map((it, i) => (it.sep ? `<div class="suggest-sep">${esc(it.sep)}</div>` : `<a class="suggest-item ${i === sel ? 'sel' : ''}" data-i="${i}">${it.icon}<span class="grow"><div>${it.title}</div><div class="sub">${it.sub}</div></span>${it.right || ''}</a>`))
      .join('');
    box.classList.toggle('open', items.length > 0);
  };
  const update = async () => {
    const q = input.value.trim();
    if (!q) { items = []; return draw(); }
    const ql = q.toLowerCase();
    const lib = guides.filter((g) => g.name.toLowerCase().includes(ql) || g.slug.includes(ql)).slice(0, 4);
    let cat = [];
    try { cat = (await api(`/api/catalog?q=${encodeURIComponent(q)}`)).results.filter((c) => !c.has_guide).slice(0, 4); } catch {}
    if (input.value.trim() !== q) return;
    items = [];
    if (lib.length) items.push({ sep: 'Guides ready' }, ...lib.map((g) => ({ kind: 'guide', slug: g.slug, icon: logo(g), title: esc(g.name), sub: `${esc(g.label)} · production ${esc(fmtDays(...g.production_days))}`, right: levelPill(g.level, g.label) })));
    if (cat.length) items.push({ sep: 'In the Composio OAuth catalog: generate a guide' }, ...cat.map((c) => ({ kind: 'gen', app: c.name, icon: logo({ name: c.name, composio: { logo: c.logo } }), title: esc(c.name), sub: `${esc(c.category || '')} · ${c.managed ? 'Composio-managed OAuth available' : 'Bring your own OAuth app'}`, right: `<span class="tag">${ICON.spark.replace('<svg', '<svg width="13" height="13"')} Generate</span>` })));
    items.push({ sep: 'Any other app' }, { kind: 'gen', app: q, icon: `<span class="logo"><span class="ph">${ICON.spark.replace('<svg', '<svg width="18" height="18"')}</span></span>`, title: `Generate a guide for “${esc(q)}”`, sub: 'An agent researches the provider live (about 2 minutes)' });
    sel = items.findIndex((x) => !x.sep);
    draw();
  };
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(update, 120); });
  input.addEventListener('keydown', (e) => {
    const real = items.map((x, i) => (x.sep ? -1 : i)).filter((i) => i >= 0);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const pos = real.indexOf(sel);
      sel = real[(pos + (e.key === 'ArrowDown' ? 1 : -1) + real.length) % real.length];
      draw();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return;
      if (items[sel] && !items[sel].sep) go(items[sel]);
      else navigate(`/generate?app=${encodeURIComponent(q)}`);
    } else if (e.key === 'Escape') { items = []; draw(); }
  });
  box.addEventListener('mousedown', (e) => {
    const el = e.target.closest('[data-i]');
    if (el) { e.preventDefault(); go(items[+el.dataset.i]); }
  });
  input.addEventListener('blur', () => setTimeout(() => box.classList.remove('open'), 120));
  input.addEventListener('focus', () => items.length && box.classList.add('open'));
  root.querySelector('button.primary').addEventListener('click', () => {
    const q = input.value.trim();
    if (!q) return input.focus();
    const exact = guides.find((g) => g.name.toLowerCase() === q.toLowerCase() || g.slug === q.toLowerCase());
    navigate(exact ? `/guide/${exact.slug}` : `/generate?app=${encodeURIComponent(q)}`);
  });
  root.querySelectorAll('[data-try]').forEach((b) => b.addEventListener('click', () => { input.value = b.dataset.try; input.focus(); update(); }));
}

// ---------- views ----------
async function viewHome() {
  $app.innerHTML = `<div class="empty"><span class="spinner"></span></div>`;
  const { guides, catalog } = await api('/api/guides');
  const byo = catalog.oauth_apps - catalog.managed;
  const filters = { all: () => true, quick: (g) => g.level <= 2, review: (g) => ['required', 'required_for_some_scopes'].includes(g.production_review), byo: (g) => g.composio?.in_catalog && !g.composio.managed, generated: (g) => g.origin === 'generated' };
  let filter = store.get('clearance.filter', 'all');
  if (!filters[filter]) filter = 'all';
  $app.innerHTML = `
    <section class="hero">
      <h1>Know your OAuth approval path before you build.</h1>
      <p class="lede">Before your agent's users can connect an app, you need an OAuth app the provider will approve. Look up any provider to see how hard it is, how long it takes, what can block you, and what an agent can do for you.</p>
      <div class="search" id="search">
        <div class="search-box">${ICON.search}<input placeholder="Search an app or paste its website, e.g. Notion, zoom.us, Xero" aria-label="App name or website" autocomplete="off" /><button class="btn primary">Get guide</button></div>
        <div class="suggest" role="listbox"></div>
        <div class="examples">Try: <button data-try="Gmail">Gmail</button>·<button data-try="Slack">Slack</button>·<button data-try="Zoom">Zoom</button>·<button data-try="Calendly">Calendly</button>·<button data-try="pipedrive.com">pipedrive.com</button></div>
      </div>
    </section>
    <div class="stats">
      <div class="stat"><b>${guides.length}</b><span>guides ready in the library</span></div>
      <div class="stat"><b>${catalog.oauth_apps}</b><span>OAuth apps in Composio's catalog</span></div>
      <div class="stat"><b>${byo} (${Math.round((byo / catalog.oauth_apps) * 100)}%)</b><span>have no managed app, so you register your own</span></div>
      <div class="stat"><b>~2 min</b><span>to generate a guide for any other app, live</span></div>
    </div>
    <section class="section">
      <div class="section-head"><div><h2>Difficulty at a glance</h2><p>Each app's place on the 0–15 rubric. Hover to see names, click to open.</p></div></div>
      <div class="spectrum">${spectrum(guides)}</div>
    </section>
    <section class="section">
      <div class="section-head">
        <div><h2>Library</h2><p>Sorted from easiest to hardest. Every guide was researched and tested by the same agent you can run live.</p></div>
        <div class="chips" id="filters">
          ${[['all', 'All'], ['quick', 'Ship this week'], ['review', 'Needs provider review'], ['byo', 'Bring your own on Composio'], ['generated', 'Generated live']].map(([k, l]) => `<button class="chip ${k === filter ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}
        </div>
      </div>
      <div class="grid" id="grid"></div>
    </section>`;
  mountSearch(document.getElementById('search'), guides);
  const drawGrid = () => {
    const list = guides.filter(filters[filter]);
    document.getElementById('grid').innerHTML = list.length ? list.map(card).join('') : `<div class="empty">Nothing here yet. <a href="/generate" data-link>Generate a guide</a>.</div>`;
  };
  drawGrid();
  document.getElementById('filters').addEventListener('click', (e) => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    filter = b.dataset.f;
    store.set('clearance.filter', filter);
    document.querySelectorAll('#filters .chip').forEach((c) => c.classList.toggle('on', c === b));
    drawGrid();
  });
}

function spectrum(guides) {
  const used = [];
  const dots = guides.map((g) => {
    const x = Math.min(100, (g.total / 15) * 100);
    const lane = used.some((u) => Math.abs(u - x) < 3.2) ? 1 : 0;
    if (!lane) used.push(x);
    return `<div class="spectrum-dot ${lane ? 'lane1' : ''}" style="left:${Math.max(2, Math.min(98, x))}%"><a href="/guide/${g.slug}" data-link aria-label="${esc(g.name)}: ${esc(g.label)}">${logo(g).replace('class="logo ', 'class="')}</a><span class="tip">${esc(g.name)} · ${g.total}</span></div>`;
  });
  return `<div class="spectrum-track">${dots.join('')}</div><div class="spectrum-legend"><span>Easy</span><span>Moderate</span><span>Involved</span><span>Hard</span><span>Very hard</span></div>`;
}

function card(g) {
  const reviewTag = ['required', 'required_for_some_scopes'].includes(g.production_review) ? `<span class="tag warn">${REVIEW_TXT[g.production_review]}</span>` : `<span class="tag good">${REVIEW_TXT[g.production_review] || 'No review'}</span>`;
  const comp = g.composio?.in_catalog ? `<span class="tag">${g.composio.managed ? 'Composio-managed OAuth' : 'BYO OAuth on Composio'}</span>` : '';
  return `<a class="card" href="/guide/${g.slug}" data-link>
    <div class="card-top">${logo(g)}<div class="grow"><h3>${esc(g.name)}</h3><div class="cat">${esc(g.category)}</div></div>${levelPill(g.level, g.label)}</div>
    <p>${esc(g.one_liner)}</p>
    <div class="card-meta"><div>First login<b>${fmtMin(g.first_test_minutes)}</b></div><div>Approval wait<b>${fmtDays(...g.wait)}</b></div><div>To production<b>${fmtDays(...g.production_days)}</b></div></div>
    <div class="card-foot">${reviewTag}${comp}${g.origin === 'generated' ? '<span class="tag">Generated live</span>' : ''}<span class="tag ${g.confidence === 'low' ? 'warn' : ''}" title="Share of claims that are tested or sourced">${g.confidence === 'low' ? 'draft · low confidence' : `confidence: ${esc(g.confidence)}`}</span></div>
  </a>`;
}

async function viewGuide(slug) {
  $app.innerHTML = `<div class="empty"><span class="spinner"></span></div>`;
  let g, cachedMd = null;
  try { g = await api(`/api/guides/${slug}`); } catch {
    // Just-generated guide on a serverless host may live on another instance: use the copy from the stream.
    try { const c = JSON.parse(sessionStorage.getItem(`clearance.guide.${slug}`)); if (c?.guide) { g = c.guide; cachedMd = c.markdown; } } catch {}
  }
  if (!g) {
    $app.innerHTML = `<div class="empty"><p>No guide for “${esc(slug)}” yet.</p><a class="btn primary" href="/generate?app=${encodeURIComponent(slug)}" data-link>${ICON.spark} Generate it now</a></div>`;
    return;
  }
  document.title = `${g.app.name} OAuth setup guide · Clearance`;
  const lvlVar = `var(${LEVEL_VAR[g.score.level] || '--l0'})`;
  const allSteps = g.phases.flatMap((p) => p.steps);
  const doneKey = `clearance.done.${g.slug}`;
  const done = new Set(store.get(doneKey, []));
  const sid = (pi, si) => `${pi}.${si}`;
  const card0 = { name: g.app.name, website: g.app.website, composio: g.composio };
  const ownerCount = (o) => allSteps.filter((s) => s.owner === o).length;
  const hoursAgent = allSteps.filter((s) => s.owner === 'agent').reduce((a, s) => a + (s.effort_minutes || 0), 0);

  const factorRows = g.score.breakdown.map((b) => {
    const f = g.factors[b.key];
    const v = b.key === 'review_wait' ? fmtDays(f.min_days, f.max_days) : String(b.value || '').replace(/_/g, ' ');
    return `<tr><td class="f">${esc(b.label)}</td><td class="v">${esc(v)}</td><td class="d">${esc(f?.detail)} ${evChip(f?.evidence)}</td><td class="p ${b.points ? '' : 'pts0'}">+${b.points}</td></tr>`;
  }).join('');

  const phases = g.phases.map((p, pi) => `
    <div class="phase"><span class="phase-num">${pi + 1}</span><h3>${esc(p.name)}</h3><div class="goal">${esc(p.goal)}</div>
    ${p.steps.map((s, si) => `<label class="step ${done.has(sid(pi, si)) ? 'done' : ''}" data-owner="${esc(s.owner)}"><input type="checkbox" data-step="${sid(pi, si)}" ${done.has(sid(pi, si)) ? 'checked' : ''} /><div>
      <div class="step-title">${esc(s.title)}</div><div class="step-detail">${esc(s.detail)}</div>
      <div class="step-meta">${ownerChip(s.owner)}${s.effort_minutes ? `<span>~${fmtMin(s.effort_minutes)}</span>` : ''}${s.wait_days_max ? `<span>· wait up to ${fmtDays(null, s.wait_days_max).replace('up to ', '')}</span>` : ''}${s.url ? `<a href="${safeUrl(s.url)}" target="_blank" rel="noopener">Open ↗</a>` : ''}${evChip(s.evidence)}</div>
    </div></label>`).join('')}</div>`).join('');

  const probeIcon = (p) => (p.ok ? '<span class="ok">✓</span>' : '<span class="bad">!</span>');
  const reach = { yes: '<span class="tag good">link ok</span>', bot_blocked: '<span class="tag" title="Site blocks automated checks; open it in a browser">bot-protected</span>', broken: '<span class="tag warn">broken link</span>', unreachable: '<span class="tag warn">unreachable</span>' };

  $app.innerHTML = `
    <div class="crumbs"><a href="/" data-link>Library</a> / ${esc(g.app.name)}</div>
    <div class="guide-head">
      ${logo(card0, 'lg')}
      <div class="grow"><h1>${esc(g.app.name)}: OAuth app setup &amp; approval</h1>
        <div class="sub">${esc(g.app.one_liner)}</div>
        <div class="small muted" style="margin-top:6px">${g.editorial?.length ? `<a href="#editorial" class="tag good" style="text-decoration:none">✓ Human-reviewed</a> ` : g.origin === 'generated' ? '<span class="tag">Generated live, not yet reviewed</span> ' : ''}Researched ${esc(g.generated_at.slice(0, 10))} · ${g.research.pages_read} pages read, ${g.probes.length} live probes, ${g.sources.length} sources checked · ${esc(g.models.research)} · ${g.generation_seconds}s</div>
      </div>
    </div>
    <div class="share" style="margin:-4px 0 20px">
        <button class="btn" id="b-link">${ICON.link} Copy link</button>
        <button class="btn" id="b-md">${ICON.copy} Copy Markdown</button>
        <a class="btn" href="${cachedMd ? URL.createObjectURL(new Blob([cachedMd], { type: 'text/markdown' })) : `/api/guides/${g.slug}.md`}" download="${g.slug}-oauth-guide.md">${ICON.md} .md</a>
        <button class="btn" id="b-print">${ICON.print} PDF</button>
        <a class="btn ghost" href="/generate?app=${encodeURIComponent(g.input || g.app.name)}&force=1" data-link title="Run the agent again for fresh results">${ICON.redo} Re-run agent</a>
    </div>
    <div class="layout">
      <aside class="toc">
        <div class="progress"><div class="small"><b id="prog-n">${done.size}</b> of ${allSteps.length} steps done</div><div class="bar"><i id="prog-bar" style="width:${(done.size / allSteps.length) * 100}%"></i></div></div>
        <a href="#verdict">Verdict</a><a href="#difficulty">Why it's ${esc(g.score.label.toLowerCase())}</a><a href="#path">Step-by-step path</a><a href="#split">Agent vs. you</a>
        ${g.gotchas.length ? '<a href="#gotchas">Gotchas</a>' : ''}${g.blockers.length ? '<a href="#blockers">When you’re blocked</a>' : ''}${g.requirements.length ? '<a href="#reqs">Requirements</a>' : ''}${g.scopes.length ? '<a href="#scopes">Scopes</a>' : ''}
        ${g.artifacts.length ? '<a href="#artifacts">Prepared for you</a>' : ''}<a href="#evidence">Evidence &amp; sources</a>
      </aside>
      <div>
        ${g.confidence.level === 'low' ? `<div class="callout" style="margin-bottom:14px;border-color:var(--l3);background:var(--l3-soft)"><h3 style="color:var(--l3)">Low confidence: treat as a draft</h3><p>Only ${g.confidence.supported_pct}% of claims are tested or sourced (${g.confidence.official_sources} official sources). The rating may be too low because unverified gates score zero. Check the uncertainties below, or re-run the agent with web search enabled.</p></div>` : ''}
        <section class="panel" id="verdict" style="--lvl:${lvlVar}">
          <div class="verdict">
            <div><div class="small muted">Difficulty</div><div class="level-label">${esc(g.score.label)}${g.confidence.level === 'low' ? '<span class="small muted" style="font-weight:500"> (unverified)</span>' : ''}</div>
              <div class="meter l${g.score.level}"><i></i><i></i><i></i><i></i><i></i></div>
              <div class="small muted">${g.score.total} / ${g.score.max} on the <a href="/how-it-works#rubric" data-link>rubric</a> · confidence <b>${esc(g.confidence.level)}</b> (${g.confidence.supported_pct}% tested or sourced)</div></div>
            <div><p class="headline">${esc(g.headline)}</p>
              <div class="kpis">
                <div class="kpi"><span>First test login</span><b>${fmtMin(g.effort.time_to_first_test_minutes)}</b><small>with your own account</small></div>
                <div class="kpi"><span>Hands-on effort</span><b>${fmtHours(g.effort.active_hours_min, g.effort.active_hours_max)}</b><small>your time, total</small></div>
                <div class="kpi"><span>Provider wait</span><b>${fmtDays(g.factors.review_wait.min_days, g.factors.review_wait.max_days)}</b><small>${esc(REVIEW_TXT[g.factors.production_review.value])}</small></div>
                <div class="kpi"><span>To production</span><b>${fmtDays(g.effort.production_days_min, g.effort.production_days_max)}</b><small>external users can connect</small></div>
              </div></div>
          </div>
        </section>
        <div class="callouts">
          <div class="callout start"><h3>Start here</h3><div class="act">${esc(g.start_here.action)}</div><p>${esc(g.start_here.why)}</p>${g.start_here.url ? `<p><a href="${safeUrl(g.start_here.url)}" target="_blank" rel="noopener">${esc(g.start_here.url)} ↗</a></p>` : ''}</div>
          <div class="callout"><h3>On Composio</h3>${g.composio?.in_catalog ? (g.composio.managed ? `<div class="act">Prototype today with Composio's managed OAuth app.</div><p>Toolkit <code>${esc(g.composio.toolkit)}</code> has a managed app, so you can skip this whole guide while you build. Follow it when you need your own branding on the consent screen, custom scopes, or your own rate-limit quota.</p>` : `<div class="act">You need your own OAuth app.</div><p>Toolkit <code>${esc(g.composio.toolkit)}</code> has no Composio-managed app. Follow this guide, then add the client ID and secret as a custom auth config.</p>`) : `<div class="act">Not in Composio's OAuth catalog.</div><p>Register your own OAuth app with this guide and use your own client credentials.</p>`}<p><a href="https://docs.composio.dev/toolkits/managed-auth" target="_blank" rel="noopener">Managed vs. your own OAuth app ↗</a></p></div>
        </div>
        <section class="panel" id="difficulty"><h2>Why it's ${esc(g.score.label.toLowerCase())}</h2><p class="panel-sub">${esc(g.score.blurb)} Points come from a fixed rubric, so the same facts always give the same score.</p>
          <table class="factors">${factorRows}</table><div class="why"><b>Effort estimate:</b> ${esc(g.effort.explanation)}</div></section>
        <section class="panel" id="path"><h2>Step-by-step path</h2><p class="panel-sub">Tick steps off as you go; progress is saved in this browser. ${ownerCount('agent')} steps an agent can do (~${fmtMin(hoursAgent)}), ${ownerCount('you')} need you, and ${ownerCount('provider')} ${ownerCount('provider') === 1 ? 'is a wait' : 'are waits'} on the provider.</p>
          <div class="filters" id="ownerf"><button class="chip on" data-o="all">All steps</button><button class="chip" data-o="you">Only mine</button><button class="chip" data-o="agent">Agent can do</button><button class="chip" data-o="provider">Waiting on provider</button></div>
          ${phases}</section>
        <section class="panel" id="split"><h2>What an agent can do vs. where you take over</h2><p class="panel-sub">Hand the agent column to your coding agent; block time on your calendar for the other column.</p>
          <div class="split"><div class="col agent"><h3>🤖 An agent can</h3><ul>${g.agent_split.agent_can.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div><div class="col you"><h3>🧑 You must</h3><ul>${g.agent_split.you_must.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div></div></section>
        ${g.gotchas.length ? `<section class="panel" id="gotchas"><h2>Gotchas</h2><p class="panel-sub">The details that change your plan, ordered by impact.</p><div class="list">${[...g.gotchas].sort((a, b) => ['blocker', 'delay', 'nuance'].indexOf(a.impact) - ['blocker', 'delay', 'nuance'].indexOf(b.impact)).map((x) => `<div class="item"><div class="item-title"><span class="impact ${x.impact}">${x.impact}</span>${esc(x.title)}</div><p>${esc(x.detail)} ${evChip(x.evidence)}</p></div>`).join('')}</div></section>` : ''}
        ${g.blockers.length ? `<section class="panel" id="blockers"><h2>When you’re blocked</h2><p class="panel-sub">What you'll see, why it happens, and how to get unstuck.</p><div class="list">${g.blockers.map((b) => `<div class="item blk"><div class="sym">${esc(b.symptom)}</div><div class="fix"><span class="muted">Cause:</span> ${esc(b.likely_cause)}</div><div class="fix"><b>Do this:</b> ${esc(b.what_to_do)} ${evChip(b.evidence)}</div></div>`).join('')}</div></section>` : ''}
        ${g.requirements.length ? `<section class="panel" id="reqs"><h2>Requirements</h2><p class="panel-sub">What you need ready, and when.</p><div class="list">${g.requirements.map((r) => `<div class="item"><div class="item-title">${esc(r.item)} <span class="tag">${esc(r.when.replace(/_/g, ' '))}</span></div><p>${esc(r.detail)} ${evChip(r.evidence)}</p></div>`).join('')}</div></section>` : ''}
        ${g.scopes.length ? `<section class="panel" id="scopes"><h2>Scopes for a typical agent integration</h2><p class="panel-sub">Request the fewest you need. Sensitive and restricted scopes are what usually trigger reviews.</p><table class="scopes"><tr><th>Scope</th><th>Why an agent needs it</th><th>Tier</th></tr>${g.scopes.map((s) => `<tr><td><code>${esc(s.scope)}</code></td><td>${esc(s.purpose)} ${evChip(s.evidence)}</td><td class="tier ${s.tier}">${esc(s.tier)}</td></tr>`).join('')}</table></section>` : ''}
        ${g.artifacts.length ? `<section class="panel" id="artifacts"><h2>Prepared for you by the agent</h2><p class="panel-sub">Copy-paste starting points. They contain placeholders only, never secrets.</p>${g.artifacts.map((a, i) => `<div class="artifact"><div class="artifact-head"><div><b>${esc(a.title)}</b><div class="muted">${esc(a.note)}</div></div><button class="btn" data-copy="${i}">${ICON.copy} Copy</button></div><pre class="${a.kind === 'text' || a.kind === 'url' ? 'wrap' : ''}"><code>${esc(a.content)}</code></pre></div>`).join('')}</section>` : ''}
        <section class="panel" id="evidence"><h2>Evidence &amp; sources</h2><p class="panel-sub">What the agent tested itself, what the sources support, and what's still uncertain. <span class="ev tested">✓ P#</span> tested · <span class="ev sourced">S#</span> sourced · <span class="ev inferred">inferred</span> judgement</p>
          <h3 style="font-size:14px;margin:4px 0 6px">OAuth endpoints</h3>
          <dl class="kv"><dt>Authorize URL</dt><dd><code>${esc(g.oauth.authorize_url || 'n/a')}</code></dd><dt>Token URL</dt><dd><code>${esc(g.oauth.token_url || 'n/a')}</code></dd><dt>PKCE</dt><dd>${esc(g.oauth.pkce.replace(/_/g, ' '))}</dd><dt>Refresh tokens</dt><dd>${esc(g.oauth.refresh_tokens)}</dd><dt>Access token lifetime</dt><dd>${esc(g.oauth.access_token_lifetime)} ${evChip(g.oauth.evidence)}</dd></dl>
          <h3 style="font-size:14px;margin:18px 0 2px">Tested by the agent (live probes, ${esc(g.probes[0]?.at?.slice(0, 10) || '')})</h3>
          <div>${g.probes.map((p) => `<div class="probe" id="ref-${p.id}">${probeIcon(p)}<div><b>${p.id} · ${esc(p.kind.replace(/_/g, ' '))}</b> ${esc(p.summary)}<div class="tgt">${esc(p.target)}</div></div></div>`).join('') || '<p class="muted small">No endpoints to probe.</p>'}</div>
          <h3 style="font-size:14px;margin:18px 0 2px">Sources</h3>
          <div>${g.sources.map((s) => `<div class="src" id="ref-${s.id}"><span class="id">${s.id}</span><span><a href="${safeUrl(s.url)}" target="_blank" rel="noopener">${esc(s.title || s.url)}</a> <span class="muted small">${esc(s.kind.replace(/_/g, ' '))}</span></span>${reach[s.reachable] || ''}</div>`).join('')}</div>
          ${g.uncertainties.length ? `<h3 style="font-size:14px;margin:18px 0 2px">Not verified / uncertain</h3><ul class="unc">${g.uncertainties.map((u) => `<li>${esc(u)}</li>`).join('')}</ul>` : ''}
          ${g.confidence.downgraded ? `<p class="small muted">The integrity check downgraded ${g.confidence.downgraded} claim label(s) because their cited evidence didn't hold up.</p>` : ''}
          ${g.editorial?.length ? `<h3 style="font-size:14px;margin:18px 0 2px" id="editorial">Human editorial review (${esc(g.reviewed_at.slice(0, 10))})</h3><p class="small muted" style="margin:0 0 6px">Where a reviewer overrode the agent's draft, and why.</p><ul class="unc">${g.editorial.map((e) => (e.note ? `<li>${esc(e.note)}</li>` : `<li><code>${esc(e.path)}</code>: <s>${esc(String(e.from).slice(0, 80))}</s> → <b>${esc(String(e.to).slice(0, 80))}</b>. ${esc(e.reason)}</li>`)).join('')}</ul>` : ''}
        </section>
      </div>
    </div>`;

  document.getElementById('b-link').onclick = () => copy(location.origin + `/guide/${g.slug}`, 'Link copied');
  document.getElementById('b-md').onclick = async () => copy(cachedMd || (await fetch(`/api/guides/${g.slug}.md`).then((r) => r.text())), 'Markdown copied');
  document.getElementById('b-print').onclick = () => window.print();
  $app.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = () => copy(g.artifacts[+b.dataset.copy].content)));
  $app.querySelectorAll('[data-step]').forEach((cb) =>
    cb.addEventListener('change', () => {
      cb.checked ? done.add(cb.dataset.step) : done.delete(cb.dataset.step);
      cb.closest('.step').classList.toggle('done', cb.checked);
      store.set(doneKey, [...done]);
      document.getElementById('prog-n').textContent = done.size;
      document.getElementById('prog-bar').style.width = `${(done.size / allSteps.length) * 100}%`;
    })
  );
  document.getElementById('ownerf').addEventListener('click', (e) => {
    const b = e.target.closest('[data-o]');
    if (!b) return;
    document.querySelectorAll('#ownerf .chip').forEach((c) => c.classList.toggle('on', c === b));
    $app.querySelectorAll('.step').forEach((s) => s.classList.toggle('hide', b.dataset.o !== 'all' && s.dataset.owner !== b.dataset.o));
  });
  if (location.hash) setTimeout(() => document.querySelector(location.hash)?.scrollIntoView(), 50);
}

function viewGenerate(initial, force) {
  const STAGES = [['research', 'Research', 'Official docs & policies'], ['probe', 'Test', 'Endpoints & links'], ['write', 'Write', 'Steps, effort, blockers'], ['score', 'Score', 'Rubric & citations']];
  $app.innerHTML = `
    <div class="gen">
      <h1>Generate a guide for any app</h1>
      <p class="lede">An agent reads the provider's official docs, probes its OAuth endpoints, checks every source it cites, and writes a guide you can share. It takes about 2 minutes. Works for apps outside the library too.</p>
      <div class="keybox">
        <label for="apikey"><b>Your API key</b> <span class="muted small">OpenAI (<code>sk-…</code>) or OpenRouter (<code>sk-or-…</code>)</span></label>
        <div class="key-row"><input type="password" id="apikey" placeholder="sk-…" autocomplete="off" spellcheck="false" /><label class="remember small"><input type="checkbox" id="remember" /> Remember in this browser</label></div>
        <p class="small muted" id="keynote">Used only for this run: sent to this server over HTTPS, then to the model provider. Never stored on the server or written into guides. A run uses GPT-5.5 with web search (up to ~17 model calls).</p>
      </div>
      <div class="search" id="gsearch" style="margin:0;max-width:none"><div class="search-box">${ICON.search}<input value="${esc(initial)}" placeholder="App name or website, e.g. Calendly or https://www.zoho.com/crm" aria-label="App name or website" autocomplete="off"/><button class="btn primary">${ICON.spark} Generate</button></div></div>
      <div id="run"></div>
    </div>`;
  const KEY_STORE = 'clearance.apikey';
  const keyInput = $app.querySelector('#apikey');
  const remember = $app.querySelector('#remember');
  keyInput.value = store.get(KEY_STORE, '') || (() => { try { return sessionStorage.getItem(KEY_STORE) || ''; } catch { return ''; } })();
  remember.checked = !!store.get(KEY_STORE, '');
  remember.onchange = () => (remember.checked ? keyInput.value && store.set(KEY_STORE, keyInput.value.trim()) : (() => { try { localStorage.removeItem(KEY_STORE); } catch {} })());
  let serverHasKey = false;
  api('/api/config').then((c) => {
    serverHasKey = c.server_key;
    if (serverHasKey) document.getElementById('keynote').textContent = 'Optional here: this server has its own key configured. A key you paste is used instead, for this run only.';
  }).catch(() => {});
  const input = $app.querySelector('#gsearch input');
  const start = (app, f = false) => {
    if (!app) return input.focus();
    history.replaceState({}, '', `/generate?app=${encodeURIComponent(app)}${f ? '&force=1' : ''}`);
    run(app, f);
  };
  $app.querySelector('#gsearch button').onclick = () => start(input.value.trim());
  input.addEventListener('keydown', (e) => e.key === 'Enter' && start(input.value.trim()));
  if (initial) start(initial, force);
  else input.focus();

  function run(app, f) {
    activeStream?.close();
    const runEl = document.getElementById('run');
    const t0 = Date.now();
    runEl.innerHTML = `<div class="stages">${STAGES.map(([k, l, s]) => `<div class="stage" data-s="${k}"><b>${l}</b><span>${s}</span></div>`).join('')}</div><div class="log" id="log"></div><div class="gen-foot"><span id="elapsed">0s</span><span id="counts"></span></div>`;
    const log = document.getElementById('log');
    const counts = { search: 0, read: 0, probe: 0 };
    const tick = setInterval(() => { const el = document.getElementById('elapsed'); if (el) el.textContent = `${Math.round((Date.now() - t0) / 1000)}s elapsed`; else clearInterval(tick); }, 1000);
    const row = (icon, html, cls = '') => {
      const secs = Math.round((Date.now() - t0) / 1000);
      log.insertAdjacentHTML('beforeend', `<div class="log-row ${cls}"><span class="t">${secs}s</span><span>${icon}</span><span class="msg">${html}</span></div>`);
      log.scrollTop = log.scrollHeight;
    };
    const setStage = (s) => {
      let seen = false;
      for (const el of document.querySelectorAll('.stage')) {
        if (el.dataset.s === s) { el.className = 'stage active'; seen = true; }
        else el.className = seen ? 'stage' : 'stage done';
      }
    };
    // The first model turn can run 20-40s with no events; keep the user oriented.
    let lastEvent = Date.now();
    const HINTS = {
      research: ['Still researching: the model is searching and reading docs', 'Checking review policies and recent changes', 'Cross-checking scopes and token rules'],
      write: ['Still writing: drafting phases, owners and effort estimates', 'Drafting blockers, gotchas and copy-paste artifacts', 'Linking every claim to its evidence'],
    };
    let hint = 0, curStage = 'research';
    const beat = setInterval(() => {
      if (!document.getElementById('log')) return clearInterval(beat);
      const list = HINTS[curStage] || HINTS.write;
      if (Date.now() - lastEvent > 14000) { row('…', esc(list[hint++ % list.length])); lastEvent = Date.now(); }
    }, 2000);
    const key = keyInput.value.trim();
    if (key) { try { sessionStorage.setItem(KEY_STORE, key); } catch {} if (remember.checked) store.set(KEY_STORE, key); }
    if (!key && !serverHasKey) {
      clearInterval(beat);
      row('✖', 'Paste your OpenAI or OpenRouter API key above to run the agent.', 'err');
      keyInput.focus();
      return;
    }
    const es = streamEvents('/api/generate', { app, force: !!f, key: key || undefined }, (e) => onEvent(e), () => {
      clearInterval(beat);
      row('✖', 'Connection lost. The agent may still be finishing. Check the library in a minute.', 'err');
    });
    activeStream = es;
    const onEvent = (e) => {
      lastEvent = Date.now();
      if (['done', 'error', 'exists'].includes(e.type)) clearInterval(beat);
      const host = (u) => { try { const x = new URL(u); return x.host + x.pathname; } catch { return u; } };
      if (e.type === 'start') row('▶', `Starting agent for <b>${esc(e.app)}</b>`, 'stage-row');
      else if (e.type === 'exists') {
        es.close();
        runEl.innerHTML = `<div class="panel" style="margin-top:18px"><h2>A guide for this app already exists</h2><p class="panel-sub">Open it, or run the agent again for fresh results.</p><a class="btn primary" href="/guide/${esc(e.slug)}" data-link>Open guide</a> <button class="btn" id="again">${ICON.redo} Re-run agent</button></div>`;
        document.getElementById('again').onclick = () => start(app, true);
      } else if (e.type === 'stage') { curStage = e.stage; hint = 0; setStage(e.stage); row('●', esc(e.message), 'stage-row'); }
      else if (e.type === 'search') { counts.search++; row('🔎', `Searched: ${esc(e.query)}`); }
      else if (e.type === 'read') { counts.read++; row('📄', `Reading <code>${esc(host(e.url))}</code>`); }
      else if (e.type === 'read_done' && !e.ok) row('⚠️', `Couldn't read <code>${esc(host(e.url))}</code> (HTTP ${e.status || 'error'}). Moving on`);
      else if (e.type === 'probe') { counts.probe++; row(e.ok ? '✅' : '⚠️', `<b>${esc(e.id)} ${esc(e.kind.replace(/_/g, ' '))}:</b> ${esc(e.summary)}`); }
      else if (e.type === 'note') row('ℹ️', esc(e.message));
      else if (e.type === 'done') {
        es.close();
        document.querySelectorAll('.stage').forEach((el) => (el.className = 'stage done'));
        row('🎉', `Guide ready in ${e.seconds}s. Opening…`, 'stage-row');
        try { sessionStorage.setItem(`clearance.guide.${e.slug}`, JSON.stringify({ guide: e.guide, markdown: e.markdown })); } catch {}
        setTimeout(() => navigate(`/guide/${e.slug}`), 900);
      } else if (e.type === 'error') {
        es.close();
        row('✖', esc(e.message), 'err');
        document.querySelectorAll('.stage.active').forEach((el) => (el.className = 'stage'));
      }
      const c = document.getElementById('counts');
      if (c) c.textContent = `${counts.search} searches · ${counts.read} pages · ${counts.probe} probes`;
    };
  }
}

// POST + streamed SSE parsing (EventSource can't send a body, and keys must not go in URLs).
function streamEvents(url, body, onEvent, onLost) {
  const ctrl = new AbortController();
  let finished = false;
  const handle = { close: () => { finished = true; ctrl.abort(); } };
  (async () => {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = chunk.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n');
          if (!data) continue;
          const ev = JSON.parse(data);
          if (['done', 'error', 'exists'].includes(ev.type)) finished = true;
          onEvent(ev);
        }
      }
      if (!finished) onLost();
    } catch (e) {
      if (!finished && e.name !== 'AbortError') onLost();
    }
  })();
  return handle;
}

async function viewHow() {
  const { rubric, levels, labels } = await api('/api/rubric');
  const rows = Object.entries(rubric).map(([k, v]) => `<tr><td><b>${esc(labels[k])}</b></td><td>${Object.entries(v).map(([val, pts]) => `${esc(val.replace(/_/g, ' '))} <b>+${pts}</b>`).join(' · ')}</td></tr>`);
  rows.splice(1, 0, `<tr><td><b>${esc(labels.review_wait)}</b></td><td>≤ 3 days <b>+0</b> · ≤ 2 weeks <b>+1</b> · ≤ 6 weeks <b>+2</b> · longer <b>+3</b> · required but unpublished <b>+2</b></td></tr>`);
  $app.innerHTML = `<div class="doc">
    <h1>How Clearance works</h1>
    <p class="lede">An AI agent's users can only connect an app if the developer has a provider OAuth app the provider allows external users to authorize. Clearance shows how hard that is for each provider, how long it takes, what can block you, and who does each step. Every claim carries its evidence.</p>
    <h2>The agent pipeline</h2>
    <div class="pipeline">
      <div class="pipe"><span class="n">01</span><b>Research</b><p>A tool-using model searches the web and reads the provider's official docs (up to 8 pages) for registration, review, verification, gating, scopes, tokens and admin-consent rules. Every fact must cite a URL.</p></div>
      <div class="pipe"><span class="n">02</span><b>Test</b><p>Deterministic probes hit the real endpoints: OIDC/RFC 8414 metadata, the authorize endpoint with an unregistered client, the token endpoint with fake credentials, and the developer portal. Every cited source is link-checked.</p></div>
      <div class="pipe"><span class="n">03</span><b>Write</b><p>A writer model turns findings and probe results into a structured guide (strict JSON schema): phases, owners, effort, blockers, scopes and copy-paste artifacts.</p></div>
      <div class="pipe"><span class="n">04</span><b>Score</b><p>Code, not the model, computes difficulty from the extracted factors. An integrity pass drops citations that don't exist and downgrades labels that lack support.</p></div>
    </div>
    <h2>Evidence labels</h2>
    <ul>
      <li><span class="ev tested">✓ P#</span> <b>Tested</b>: confirmed by a probe the agent ran (for example, the token endpoint is live and returns <code>invalid_client</code> for fake credentials). Only allowed when a successful probe backs the claim.</li>
      <li><span class="ev sourced">S#</span> <b>Sourced</b>: supported by a cited page, usually the provider's official docs. Sources are link-checked, and broken links can't back a claim.</li>
      <li><span class="ev inferred">inferred</span> <b>Inferred</b>: the agent's judgement, such as an effort estimate or a pattern seen across providers. Treat it as a starting point to confirm.</li>
    </ul>
    <h2 id="rubric">Difficulty rubric</h2>
    <p>The model only <i>extracts</i> factors; this fixed table turns them into points, so apps compare fairly and every rating can be explained.</p>
    <table class="rubric"><tr><th>Factor</th><th>Points</th></tr>${rows.join('')}</table>
    <p style="margin-top:12px">${levels.map((l) => `${levelPill(l.level, l.label)} ${l.max == null ? '10+' : `≤ ${l.max}`}`).join(' &nbsp; ')}</p>
    <h2>What the agent does vs. what needs you</h2>
    <p>Agents can research, check endpoints, draft scope justifications and review answers, generate config and manifests, and write test scripts. They should not create provider accounts, accept legal terms, pay, verify domains, record demo videos, or submit reviews on your behalf. Every step in a guide is tagged with its owner, so the hand-off points are explicit.</p>
    <h2>Known limits</h2>
    <ul>
      <li>Probes confirm endpoints are live and behave like OAuth servers. They can't create a real app, because that needs your provider account.</li>
      <li>Review timelines come from official SLAs where they exist, and otherwise from developer reports (labelled as such). Providers change policies often, so check the research date.</li>
      <li>Some docs sites block automated checks. These are shown as <i>bot-protected</i>, not broken.</li>
    </ul>
    <h2>Getting to 100 guides</h2>
    <p>The library uses the same pipeline as the live flow (<code>npm run build:library</code>). Composio's catalog lists ${'402'} OAuth apps, 275 of them without a managed app. Those are the apps where developers have to register their own OAuth app and are most likely to get stuck, so they come first, ordered by usage.</p>
  </div>`;
}

render();
