import { S } from './llm.js';

// ---------- Phase 1: research findings (what the agent must discover) ----------
export const researchSchema = S.obj({
  app_name: S.str('Canonical product name, e.g. "Slack"'),
  provider: S.str('Company that operates the OAuth server'),
  website: S.str('Homepage URL'),
  category: S.str('Short category, e.g. "team chat"'),
  is_real_app: S.bool(),
  oauth_supported: S.enm(['yes', 'no', 'partial', 'unclear'], 'Does the provider let third-party developers register OAuth apps for user authorization?'),
  developer_portal_url: S.nstr('Where a developer registers/creates the OAuth app'),
  authorize_url: S.nstr('OAuth 2.0 authorization endpoint (exact URL from docs)'),
  token_url: S.nstr('OAuth 2.0 token endpoint (exact URL from docs)'),
  discovery_url: S.nstr('OIDC / RFC 8414 metadata URL if one exists'),
  facts: S.arr(
    S.obj({
      topic: S.enm(['registration', 'review', 'verification', 'scopes', 'limits', 'tokens', 'pricing_access', 'admin_consent', 'distribution', 'recent_change', 'other']),
      claim: S.str('One specific, checkable statement'),
      source_url: S.str('URL that supports the claim'),
      source_kind: S.enm(['official_docs', 'official_blog_or_forum', 'community_report']),
      quote: S.str('Short supporting excerpt (<= 25 words) from the source, or "" if paraphrased from search'),
    })
  ),
  open_questions: S.arr(S.str()),
});

// ---------- Phase 3: the guide (what the developer gets) ----------
const evidence = S.obj({
  type: S.enm(['tested', 'sourced', 'inferred'], 'tested = confirmed by a probe P#; sourced = backed by a source S#; inferred = judgement, not directly supported'),
  refs: S.arr(S.str('S# or P# ids from the provided lists only')),
});

const factor = (values, description) =>
  S.obj({ value: S.enm(values, description), detail: S.str('<= 30 words, specific to this provider, lead with the fact'), evidence });

export const guideSchema = S.obj({
  app: S.obj({
    name: S.str('Short product name as developers say it, e.g. "Slack", "Gmail", "Microsoft Outlook" (not "Slack API")'),
    provider: S.str(),
    website: S.str(),
    category: S.str(),
    developer_portal_url: S.nstr(),
    one_liner: S.str('What setting up an OAuth app here is like, in <= 20 words'),
  }),
  oauth_supported: S.enm(['yes', 'no', 'partial']),
  headline: S.str('2 sentences: the honest verdict a busy developer needs first (difficulty + main gate + time)'),
  factors: S.obj({
    production_review: factor(
      ['none', 'optional_listing', 'required_for_some_scopes', 'required'],
      '"required" ONLY if the provider technically blocks or caps external users from authorizing until it approves the app. A marketplace/directory listing that is only for discoverability, or a submission the docs recommend while a public/unlisted app already works for any customer, is "optional_listing" (explain the nuance in gotchas).'
    ),
    review_wait: S.obj({
      min_days: S.num('Typical minimum calendar days waiting on the provider for ANY gate on the minimum production path (app review, publisher/business verification, API access approval, go-live); 0 if none'),
      max_days: S.num('Typical maximum incl. back-and-forth; 0 if none. If a gate exists but no SLA is published, estimate from credible reports (evidence "inferred") rather than null'),
      detail: S.str(),
      evidence,
    }),
    security_assessment: factor(['none', 'conditional', 'required'], 'Third-party security audit / assessment (e.g. Google CASA) or formal security review needed to reach production'),
    business_verification: factor(['no', 'yes'], 'Must the developer prove a legal entity, verified domain or publisher identity to reach production? Marketplace listing criteria alone do not count.'),
    gated_access: factor(
      ['none', 'paid_plan', 'partner_program', 'application_approval'],
      'Is creating the app or calling the needed API at all gated behind a recurring paid plan, partner program, or an API-product access application? A nominal one-time registration fee (< $100) is NOT gating (put it in requirements). Do NOT re-count the production review here.'
    ),
    dev_mode_limits: factor(
      ['none', 'user_cap', 'own_org_only', 'other'],
      'Restrictions on an app that is not (yet) approved/listed: user or install caps, own-org-only installs, reduced rate limits for unlisted apps, unverified-app warning screens. State the numbers.'
    ),
    customer_admin_approval: factor(['no', 'sometimes', 'usually'], "Do the developer's end-customers' admins often have to approve/allowlist the app?"),
  }),
  effort: S.obj({
    time_to_first_test_minutes: S.num('Minutes from zero to a working OAuth login with your own account'),
    active_hours_min: S.num('Hands-on developer hours to reach production, low end'),
    active_hours_max: S.num('Hands-on developer hours to reach production, high end'),
    production_days_min: S.num('Calendar days to production-ready for external users, low end'),
    production_days_max: S.num('Calendar days to production-ready for external users, high end'),
    explanation: S.str('Why these numbers; what makes it shorter or longer'),
  }),
  start_here: S.obj({ action: S.str('The single first thing to do, imperative'), url: S.nstr(), why: S.str() }),
  phases: S.arr(
    S.obj({
      name: S.str('e.g. Prepare, Register the app, Configure, Test, Get approved, Launch & maintain'),
      goal: S.str(),
      steps: S.arr(
        S.obj({
          title: S.str('Imperative, specific'),
          detail: S.str('Exactly what to click/enter/decide; name real settings and fields'),
          owner: S.enm(['agent', 'you', 'provider'], 'agent = an AI agent can do this unattended; you = needs a human (accounts, legal, payment, judgement, video, DNS); provider = waiting on the provider'),
          effort_minutes: S.num(),
          wait_days_max: S.num('Only for provider-owned waits, else null'),
          url: S.nstr(),
          evidence,
        })
      ),
    })
  ),
  requirements: S.arr(S.obj({ item: S.str(), detail: S.str(), when: S.enm(['always', 'before_review', 'for_sensitive_scopes', 'for_listing']), evidence })),
  scopes: S.arr(S.obj({ scope: S.str(), purpose: S.str(), tier: S.enm(['basic', 'sensitive', 'restricted', 'unknown']), evidence })),
  gotchas: S.arr(S.obj({ title: S.str(), detail: S.str(), impact: S.enm(['blocker', 'delay', 'nuance']), evidence })),
  blockers: S.arr(S.obj({ symptom: S.str('What the developer sees, e.g. an exact error or rejection reason'), likely_cause: S.str(), what_to_do: S.str(), evidence })),
  agent_split: S.obj({
    agent_can: S.arr(S.str('Concrete tasks an agent can do for the developer')),
    you_must: S.arr(S.str('Concrete hand-off points where a human must act, and why')),
  }),
  artifacts: S.arr(
    S.obj({
      title: S.str(),
      kind: S.enm(['env', 'json', 'yaml', 'text', 'url']),
      content: S.str('Copy-pasteable content. No real secrets; use placeholders like <CLIENT_ID>.'),
      note: S.str(),
    })
  ),
  oauth: S.obj({
    authorize_url: S.nstr(),
    token_url: S.nstr(),
    pkce: S.enm(['required', 'supported', 'not_supported', 'unknown']),
    refresh_tokens: S.str('How refresh works / expiry, short'),
    access_token_lifetime: S.str(),
    evidence,
  }),
  uncertainties: S.arr(S.str('What we could not verify and how the developer can confirm it')),
});
