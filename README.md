# Clearance: know your OAuth approval path before you build

**Composio APM Integrations take-home.** A working product that tells agent builders how hard it is to get a provider OAuth app approved, how long it takes, what can block them, and exactly what an agent can do for them vs. where they must take over. It has a library of ready-made guides plus a live agent that generates a guide for any app.

**Live:** https://clearance-sigma-nine.vercel.app · **Source:** https://github.com/krishna2004-coder/clearance

### Try the live agent
1. Open **Generate** and paste your own **OpenAI** (`sk-…`) or **OpenRouter** (`sk-or-…`) API key. The hosted demo holds no key of its own. Your key is used for that run only: it goes to the server over HTTPS and then to the model provider, and is never stored or written into guides.
2. Enter any app name or website, including apps outside the library, and watch it research, test, write and score in about 2 minutes.

Runs use GPT-5.5 for research and writing, plus web search (OpenAI's `gpt-5-search-api`, or OpenRouter's web plugin). The key needs credits.

### Run locally
```bash
# Node 20+, zero dependencies
cp .env.example .env           # optional: add a server-side key; otherwise paste one in the UI
npm start                      # http://localhost:3344
npm run build:library          # (re)generate the library with the same agent (needs a key in .env)
npm run editorial              # apply the recorded human review pass
# Optional env: RESEARCH_MODEL / WRITER_MODEL (default openai/gpt-5.5), SEARCH_MODEL
```
Deploys to Vercel as-is (`vercel deploy`). `server.js` is the entry point, and `npm run bundle` packs the library and catalog into `lib/data.generated.js` so the serverless function ships with them.

---

## 1. The problem, framed

A developer's integration has three layers: **their product** → **a provider OAuth app** (client ID/secret, redirect URIs, scopes, and the provider's approval) → **their users' connections** (tokens per user). The middle layer is where launches stall. Composio's catalog lists 402 OAuth toolkits, and **275 of them (68%) have no Composio-managed app**, so the developer must register their own. Even where a managed app exists, teams bring their own for a branded consent screen, custom scopes, or their own rate limits.

What they actually need to know, in order:
1. **Is this an afternoon or a quarter?** (difficulty and calendar time, with waiting separated from working)
2. **What could block me?** (reviews, security assessments, verification, gated APIs, caps on unapproved apps)
3. **What do I do first, and next?**
4. **What can my agent do, and where must a human step in?**
5. **Can I trust this?** (what was tested vs. read vs. guessed)

## 2. What I built

| Surface | What it does |
|---|---|
| **Library** (`/`) | 12 varied guides sorted easiest → hardest, a 0–15 difficulty spectrum, filters ("Ship this week", "Needs provider review", "Bring your own on Composio"), and search with autocomplete across the library and all 402 Composio OAuth toolkits. |
| **Guide** (`/guide/:app`) | Verdict (difficulty, first-login time, hands-on hours, provider wait, time to production) → **Start here** → Composio managed/BYO callout → rubric breakdown → a phased step-by-step checklist (owner on every step: 🤖 agent / 🧑 you / ⏳ provider; progress saved) → agent-vs-you split → gotchas by impact → "when you're blocked" (symptom → cause → fix) → requirements → scopes by tier → **artifacts the agent prepared** (`.env` template, review-ready scope justifications, auth URL, manifests) → evidence (probes, link-checked sources, uncertainties, human edits). Shareable via link, Markdown, `.md` download, and print-to-PDF. |
| **Live generation** (`/generate`) | Enter any name or URL. The agent researches, tests and writes a guide in about 2 minutes, streaming each search, page read and probe as it happens. Works for apps outside the library and outside Composio's catalog. |
| **How it works** (`/how-it-works`) | Pipeline, evidence labels, the full rubric, and known limits, so a reader can audit any rating. |

## 3. How the agent works

```
Research ──► Test ──► Write ──► Score
```
1. **Research** (`gpt-5.5`, Responses API with web search plus a `fetch_page` tool): reads official docs (up to 8 pages) across 7 areas: registration, distribution and review, verification, gated access, scopes, tokens, and customer-admin approval. Every fact must cite a URL. The output is a strict JSON schema.
2. **Test** (deterministic code, not the LLM):
   - Fetches OIDC/RFC 8414 metadata.
   - Hits the **authorize endpoint with an unregistered client**.
   - POSTs **fake credentials to the token endpoint** (expects `invalid_client`).
   - Checks the developer portal (for example, whether it redirects to sign-in).
   - **Link-checks every cited source.** Bot walls are reported as such, not as broken links.
   - Fetches go through an SSRF guard that blocks private IPs.
3. **Write** (`gpt-5.5`, strict schema): turns findings and probe results into the guide. Each claim carries an evidence label and refs (`S#` source, `P#` probe).
4. **Score** (code):
   - The model only *extracts* factors. A fixed rubric turns them into points, so the same facts always give the same rating.
   - An **integrity pass** drops refs that don't exist and downgrades labels: "tested" without a passing probe becomes "sourced" or "inferred", and broken sources can't back a claim.

## 4. Product decisions (and why)

- **Separate "hands-on hours" from "waiting on the provider."** A developer plans these differently. 6 hours of work and 6 weeks of review mean very different things for a launch date.
- **Score the minimum viable path to production, not the gold-plated one.** The first draft rated Linear "Hard" because the agent treated an *optional* directory listing as a required review and counted it three times. I tightened the factor definitions: a listing counts only if the provider technically blocks external users without it, each gate counts once, a nominal one-time fee isn't gating, and every provider wait counts, including verification. Listing-only requirements go in gotchas.
- **Agent-specific constraints matter more than generic OAuth facts.** The research found Slack's 2025 change: unlisted apps get `conversations.history` at **1 request/min, 15 objects** (I verified this against Slack's changelog). For a history-reading agent, that makes Marketplace listing effectively mandatory, so the guide now leads with it.
- **Owner on every step.** "What can the agent do" isn't a separate essay. It's a property of each step, so the hand-off points are explicit and you can filter by them.
- **Composio context on every guide.** If a managed app exists, the best advice is "prototype now with the managed app, follow this guide when you need branding, scopes or quota."
- **Agent drafts, human reviews, both visible.** Library guides went through a recorded editorial pass (`scripts/editorial.js`). Every override shows before → after → reason on the guide. Live-generated guides are marked "not yet reviewed".

## 5. Results across the library

| App | Rating (pts) | Gate | Provider wait | To production | Composio |
|---|---|---|---|---|---|
| Notion | Easy (1) | none | none | same day | managed |
| GitHub | Moderate (2) | listing optional | none | ≤1 day | managed |
| Linear | Moderate (2) | listing optional | none | ≤1 day | managed |
| Microsoft Outlook | Moderate (3) | publisher verification | 1–5 days | ≤5 days | managed |
| Salesforce | Moderate (3) | listing optional, admin install | none | 1–42 days | managed |
| Slack | Moderate (3) | listing optional, but history rate limit | none (≤9 wk if listed) | ≤1 day | managed |
| Xero | Hard (7) | paid tier past 5 tenants | none | same day | **BYO** |
| DocuSign | Hard (8) | Go-Live review + partner program | 0–2 days | 1–3 days | **BYO** |
| HubSpot | Hard (9) | review for sensitive-data scopes | ≤60 days | 1–60 days | managed |
| Shopify | Hard (9) | App Store review + protected data | 1–3 weeks | 1–4 weeks | **BYO** |
| Gmail | Very hard (10) | restricted-scope verification + CASA | 2–7 weeks | 2–10 weeks | managed |
| LinkedIn | Very hard (12) | product access approval | ≤13 weeks | ≤13 weeks | managed |

**Evidence:**
- 47 live probes, 40 passed. The rest were tenant-specific endpoints such as Salesforce's `{MyDomain}`, reported as "not probed".
- 136 cited sources, **all 136 reachable** when checked.
- 699 labelled claims. Average generation time is about 2 minutes.

## 6. What is tested, sourced, and uncertain

- **Tested:** endpoints are live and behave like OAuth servers (metadata, unregistered-client handling, `invalid_client` on fake credentials), PKCE methods where metadata publishes them, portal reachability and sign-in walls, and link health of every source.
- **Sourced:** registration paths, review triggers, timelines, caps and scopes. Mostly official docs; community reports (for example Reddit, for LinkedIn wait times) are labelled as community.
- **Not done:** creating real OAuth apps or submitting reviews. That needs the developer's own provider accounts and legal acceptance, which is exactly the "you must" column. Effort estimates are labelled *inferred*. Each guide lists its open questions and how to confirm them.

## 7. Known limits and next steps

- **Path to 100:** the same pipeline runs in batch (`npm run build:library`). Prioritize the 275 BYO toolkits by usage, add a weekly re-run, and use a diff alert when a provider's policy text changes. Freshness is the real moat.
- **Deeper "attempt the setup":** with a sandbox account per provider, the agent could create a test app (for example via Slack manifests or GitHub app manifests), run a real OAuth round-trip, and record the actual consent screen.
- **Calibration:** keep a small set of developer-verified ratings as an eval set for the rubric. Add community signals ("it took us 19 days") as a separate evidence class.
- **Library calibration:** the 12 library guides were generated before the final rubric wording (minimum-path scoring, nominal fees, verification waits). They were corrected by the recorded editorial pass rather than regenerated, because the API credits ran out. Spotify and Workday were planned but not generated for the same reason.
- **Hosted storage:** on Vercel, live-generated guides are written to the function's temporary disk, so their share link may not survive a cold start. The finished guide is also streamed to the browser, which keeps the page and its Markdown export working for that visitor. A production version would use a database and a review queue for live-generated guides.
- **Demo limits:** basic per-IP rate limits and concurrency caps. There's no auth.

## Files

```
server.js              HTTP server + Vercel entry: API, streamed live generation, SPA shell
lib/agent.js           Research → Test → Write → Score pipeline + prompts
lib/llm.js             Chat Completions client for OpenAI or OpenRouter (key per run)
lib/schema.js          Strict JSON schemas (research findings, guide)
lib/tools.js           fetch_page tool, SSRF guard, OAuth probes, link checker
lib/score.js           Deterministic rubric, evidence integrity, confidence
lib/catalog.js         Composio OAuth catalog lookup (data/composio-oauth-toolkits.json)
lib/markdown.js        Markdown export
scripts/               build-library.js (batch), editorial.js (recorded human review), bundle-data.js
lib/data.generated.js  Bundled library + catalog for serverless hosts (generated)
public/                Vanilla JS front-end (no build step)
data/guides/*.json     The library
```
