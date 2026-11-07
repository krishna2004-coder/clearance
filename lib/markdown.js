// Render a guide as portable Markdown so it can be pasted into a PR, Notion, or a ticket.
const ev = (e) => (!e ? '' : ` _[${e.type}${e.refs?.length ? ': ' + e.refs.join(', ') : ''}]_`);
const owner = { agent: '🤖 Agent', you: '🧑 You', provider: '⏳ Provider' };
const range = (a, b, unit) => (a == null && b == null ? 'unknown' : a === b || b == null ? `${a} ${unit}` : `${a ?? 0}–${b} ${unit}`);

export function toMarkdown(g, baseUrl = '') {
  const L = [];
  L.push(`# ${g.app.name}: OAuth app setup & approval guide`, '');
  L.push(`> ${g.headline}`, '');
  L.push(`| Difficulty | Time to first test | Hands-on effort | Waiting on ${g.app.provider} | Time to production | Confidence |`);
  L.push('|---|---|---|---|---|---|');
  L.push(`| **${g.score.label}** (${g.score.total}/${g.score.max}) | ${g.effort.time_to_first_test_minutes ?? '?'} min | ${range(g.effort.active_hours_min, g.effort.active_hours_max, 'h')} | ${range(g.factors.review_wait.min_days, g.factors.review_wait.max_days, 'days')} | ${range(g.effort.production_days_min, g.effort.production_days_max, 'days')} | ${g.confidence.level} |`, '');
  L.push(`**Start here:** ${g.start_here.action}${g.start_here.url ? ` → ${g.start_here.url}` : ''}. ${g.start_here.why}`, '');
  if (g.composio?.in_catalog) L.push(`**On Composio:** ${g.composio.managed ? 'Composio-managed OAuth is available for this toolkit, so you can prototype without registering an app. Bring your own app for a branded consent screen, custom scopes or your own rate limits.' : 'No managed OAuth app. You must register your own OAuth app and create a custom auth config.'}`, '');
  L.push('## What makes it easy or hard', '');
  for (const b of g.score.breakdown) {
    const f = g.factors[b.key];
    L.push(`- **${b.label}:** ${b.value} (+${b.points}). ${f?.detail || ''}${ev(f?.evidence)}`);
  }
  L.push('', `_${g.effort.explanation}_`, '');
  L.push('## The path', '');
  g.phases.forEach((p, i) => {
    L.push(`### ${i + 1}. ${p.name}`, `${p.goal}`, '');
    for (const s of p.steps) {
      const meta = [owner[s.owner], s.effort_minutes ? `~${s.effort_minutes} min` : null, s.wait_days_max ? `wait up to ${s.wait_days_max} days` : null].filter(Boolean).join(' · ');
      L.push(`- [ ] **${s.title}** (${meta}). ${s.detail}${s.url ? ` ${s.url}` : ''}${ev(s.evidence)}`);
    }
    L.push('');
  });
  L.push('## What an agent can do vs. where you take over', '', '**Agent can:**', ...g.agent_split.agent_can.map((x) => `- ${x}`), '', '**You must:**', ...g.agent_split.you_must.map((x) => `- ${x}`), '');
  if (g.requirements.length) L.push('## Requirements', '', ...g.requirements.map((r) => `- **${r.item}** (${r.when.replace(/_/g, ' ')}). ${r.detail}${ev(r.evidence)}`), '');
  if (g.scopes.length) L.push('## Scopes', '', '| Scope | Purpose | Tier |', '|---|---|---|', ...g.scopes.map((s) => `| \`${s.scope}\` | ${s.purpose} | ${s.tier} |`), '');
  if (g.gotchas.length) L.push('## Gotchas', '', ...g.gotchas.map((x) => `- **${x.title}** (${x.impact}). ${x.detail}${ev(x.evidence)}`), '');
  if (g.blockers.length) L.push('## When you hit a blocker', '', ...g.blockers.map((b) => `- **${b.symptom}**: ${b.likely_cause}. **Do:** ${b.what_to_do}${ev(b.evidence)}`), '');
  for (const a of g.artifacts) L.push(`### Prepared by the agent: ${a.title}`, a.note, '```' + (a.kind === 'env' ? 'bash' : a.kind === 'url' ? '' : a.kind), a.content, '```', '');
  L.push('## Evidence', '', '**Tested by the agent (live probes):**', ...g.probes.map((p) => `- ${p.id} ${p.ok ? '✅' : '⚠️'} ${p.kind.replace(/_/g, ' ')} (${p.target}): ${p.summary}`), '');
  L.push('**Sources:**', ...g.sources.map((s) => `- ${s.id} [${s.title || s.url}](${s.url}) (${s.kind.replace(/_/g, ' ')}; link check: ${s.reachable})`), '');
  if (g.uncertainties.length) L.push('**Not verified / uncertain:**', ...g.uncertainties.map((u) => `- ${u}`), '');
  L.push(`---`, `Generated ${g.generated_at.slice(0, 10)} by Clearance (${g.models.research}). ${g.confidence.supported_pct}% of claims tested or sourced.${baseUrl ? ` Live version: ${baseUrl}/guide/${g.slug}` : ''}`);
  return L.join('\n');
}
