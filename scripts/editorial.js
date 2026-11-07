// Human editorial pass over agent-generated library guides.
// Every edit is recorded on the guide (field, before, after, reason) and shown in the UI,
// so a reader can see exactly where a human overrode the agent and why.
// Usage: node scripts/editorial.js
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../lib/env.js';
import { scoreGuide } from '../lib/score.js';

const MIN_PATH = 'Rubric scores the minimum path to production; this requirement only applies to the optional listing.';

const EDITS = {
  github: [{ path: 'app.name', to: 'GitHub', reason: 'Display name' }],
  gmail: [{ path: 'app.name', to: 'Gmail', reason: 'Display name' }],
  notion: [{ path: 'app.name', to: 'Notion', reason: 'Display name' }],
  docusign: [{ path: 'app.name', to: 'DocuSign', reason: 'Display name' }],
  hubspot: [{ path: 'app.name', to: 'HubSpot', reason: 'Display name' }],
  linkedin: [
    { path: 'app.name', to: 'LinkedIn', reason: 'Display name' },
    { note: 'Score reflects the gated products (Community Management, Marketing APIs) most agent use cases need. Sign In with LinkedIn and member posting (w_member_social) alone are self-serve and would score Easy.' },
  ],
  outlook: [
    { path: 'app.name', to: 'Microsoft Outlook', reason: 'Display name' },
    {
      path: 'factors.review_wait',
      to: { min_days: 1, max_days: 5, detail: 'No app review, but publisher verification needs a verified Microsoft AI Cloud Partner Program account. Partner verification typically takes a few business days.', evidence: { type: 'inferred', refs: [] } },
      reason: 'Rubric counts every provider-side wait on the production path, including verification, not just formal app reviews.',
    },
  ],
  salesforce: [
    { path: 'app.name', to: 'Salesforce', reason: 'Display name' },
    {
      path: 'factors.security_assessment',
      merge: { value: 'none', detail: 'None for distributing an External Client App outside AppExchange. AppExchange Security Review (plan 4–6 weeks) applies only if you list publicly.' },
      reason: MIN_PATH,
    },
  ],
  shopify: [
    { path: 'app.name', to: 'Shopify', reason: 'Display name' },
    {
      path: 'factors.gated_access',
      merge: { value: 'none', detail: 'No paid plan or partner gate to build. Public distribution requires a one-time Shopify App Store registration fee, listed under requirements.' },
      reason: 'A nominal one-time fee is not access gating under the rubric (verified: shopify.dev/docs/apps/launch/distribution says "one-time fee").',
    },
  ],
  slack: [
    {
      path: 'factors.security_assessment',
      merge: { value: 'none', detail: 'None for unlisted public distribution. Slack Marketplace submission adds security and scope review, which applies only if you list.' },
      reason: MIN_PATH,
    },
    {
      path: 'factors.dev_mode_limits',
      merge: {
        value: 'other',
        detail: 'New apps install only in your dev workspace until you activate public distribution. Unlisted commercial apps get conversations.history/replies at 1 request/min, max 15 objects.',
        evidence: { type: 'sourced', refs: ['S2', 'S7'] },
      },
      reason: 'Agent-relevant limit was under-reported; numbers verified against the cited Slack changelog (S7).',
    },
    {
      path: 'gotchas.1',
      merge: {
        title: 'Unlisted apps get 1 request/min on conversations.history',
        impact: 'blocker',
        detail: 'Since 2025-05-29, commercially distributed non-Marketplace apps get conversations.history and conversations.replies at 1 request/min and 15 objects. If your agent reads channel history, plan for a Marketplace listing (up to ~9 weeks of review).',
      },
      reason: 'Impact raised from "delay" to "blocker" for agents that read history; exact limits from S7.',
    },
    {
      path: 'headline',
      to: 'Slack is quick to build, and you can distribute an unlisted app without review. The catch for agents: unlisted apps get conversations.history at 1 request/min, so agents that read history effectively need a Marketplace listing (up to ~9 weeks).',
      reason: 'Headline should lead with the constraint that matters most to agent builders.',
    },
  ],
};

const get = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
function set(o, p, v) {
  const ks = p.split('.');
  const last = ks.pop();
  const parent = ks.reduce((a, k) => a[k], o);
  parent[last] = v;
}

for (const [slug, edits] of Object.entries(EDITS)) {
  const file = path.join(config.guidesDir, `${slug}.json`);
  if (!fs.existsSync(file)) continue;
  const g = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (g.editorial?.length) continue; // idempotent: never double-apply
  const log = [];
  const before = g.score.total;
  for (const e of edits) {
    if (e.note) { log.push({ note: e.note }); continue; }
    const prev = get(g, e.path);
    const next = e.merge ? { ...prev, ...e.merge } : e.to;
    set(g, e.path, next);
    const brief = (v) => (typeof v === 'object' ? v.value ?? v.title ?? (v.max_days != null ? `${v.min_days}–${v.max_days} days` : '…') : v);
    log.push({ path: e.path, from: brief(prev), to: brief(next), reason: e.reason });
  }
  g.score = scoreGuide(g);
  g.editorial = log;
  g.reviewed_at = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(g, null, 2));
  console.log(`${slug}: ${log.length} edits, score ${before} → ${g.score.total} (${g.score.label})`);
}
