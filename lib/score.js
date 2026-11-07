// Deterministic difficulty rubric. The model extracts factors; code scores them,
// so the same facts always produce the same rating and every point is explainable.

export const RUBRIC = {
  production_review: { none: 0, optional_listing: 1, required_for_some_scopes: 2, required: 3 },
  security_assessment: { none: 0, conditional: 2, required: 3 },
  business_verification: { no: 0, yes: 1 },
  gated_access: { none: 0, paid_plan: 2, application_approval: 2, partner_program: 3 },
  dev_mode_limits: { none: 0, user_cap: 1, own_org_only: 1, other: 1 },
  customer_admin_approval: { no: 0, sometimes: 1, usually: 1 },
};

export const FACTOR_LABELS = {
  production_review: 'Provider review before external users',
  review_wait: 'Approval wait',
  security_assessment: 'Security assessment',
  business_verification: 'Business / identity verification',
  gated_access: 'Gated API access',
  dev_mode_limits: 'Limits before approval',
  customer_admin_approval: 'Customer admin approval',
};

export const LEVELS = [
  { level: 1, label: 'Easy', max: 1, blurb: 'Self-serve. Create the app and ship the same day.' },
  { level: 2, label: 'Moderate', max: 3, blurb: 'Self-serve with a few settings or limits to plan around.' },
  { level: 3, label: 'Involved', max: 6, blurb: 'Expect a review or verification step before external users.' },
  { level: 4, label: 'Hard', max: 9, blurb: 'Formal review, verification or gated access; plan weeks.' },
  { level: 5, label: 'Very hard', max: Infinity, blurb: 'Partnerships, audits or approvals that can take months.' },
];

function waitPoints(maxDays, reviewValue) {
  // Review is required but nobody publishes a timeline: assume weeks, not zero.
  if (maxDays == null) return ['required', 'required_for_some_scopes'].includes(reviewValue) ? 2 : 0;
  if (maxDays <= 0) return 0;
  if (maxDays <= 3) return 0;
  if (maxDays <= 14) return 1;
  if (maxDays <= 42) return 2;
  return 3;
}

export function scoreGuide(g) {
  const f = g.factors;
  const breakdown = [];
  for (const key of Object.keys(RUBRIC)) {
    const v = f[key]?.value;
    breakdown.push({ key, label: FACTOR_LABELS[key], value: v, points: RUBRIC[key][v] ?? 0 });
  }
  const wp = waitPoints(f.review_wait?.max_days, f.production_review?.value);
  breakdown.splice(1, 0, {
    key: 'review_wait',
    label: FACTOR_LABELS.review_wait,
    value: f.review_wait?.max_days ? `up to ${f.review_wait.max_days} days` : wp ? 'unpublished' : 'none',
    points: wp,
  });
  const total = breakdown.reduce((a, b) => a + b.points, 0);
  const lvl = g.oauth_supported === 'no' ? { level: 0, label: 'No OAuth', blurb: 'This provider does not offer third-party OAuth apps.' } : LEVELS.find((l) => total <= l.max);
  return { total, max: 15, level: lvl.level, label: lvl.label, blurb: lvl.blurb, breakdown };
}

// Walk every evidence object; drop refs that don't exist and downgrade the label
// so a guide can never claim "tested" or "sourced" without a real probe/source behind it.
export function enforceEvidence(g, sourceIds, probes) {
  const okProbe = new Set(probes.filter((p) => p.ok).map((p) => p.id));
  const anyProbe = new Set(probes.map((p) => p.id));
  const stats = { tested: 0, sourced: 0, inferred: 0, downgraded: 0 };
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    if (node.evidence && typeof node.evidence === 'object' && 'type' in node.evidence) {
      const e = node.evidence;
      e.refs = (e.refs || []).filter((r) => sourceIds.has(r) || anyProbe.has(r));
      const hasP = e.refs.some((r) => okProbe.has(r));
      const hasS = e.refs.some((r) => sourceIds.has(r));
      const before = e.type;
      if (e.type === 'tested' && !hasP) e.type = hasS ? 'sourced' : 'inferred';
      if (e.type === 'sourced' && !hasS) e.type = hasP ? 'tested' : 'inferred';
      if (before !== e.type) stats.downgraded++;
      stats[e.type]++;
    }
    for (const k of Object.keys(node)) if (k !== 'evidence') visit(node[k]);
  };
  visit(g);
  return stats;
}

export function confidenceFrom(stats, sources) {
  const total = stats.tested + stats.sourced + stats.inferred || 1;
  const supported = (stats.tested + stats.sourced) / total;
  const official = sources.filter((s) => s.kind === 'official_docs').length;
  let level = 'low';
  if (supported >= 0.8 && official >= 3) level = 'high';
  else if (supported >= 0.6 && official >= 1) level = 'medium';
  return { level, supported_pct: Math.round(supported * 100), official_sources: official, ...stats };
}
