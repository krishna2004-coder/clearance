// Generate library guides with the same agent pipeline the live flow uses.
// Usage: node scripts/build-library.js [app ...]   (defaults to the curated demo set)
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../lib/env.js';
import { generateGuide } from '../lib/agent.js';

const DEFAULT_SET = [
  ['github', 'GitHub (GitHub App / OAuth App)'],
  ['linear', 'Linear'],
  ['notion', 'Notion (public integration)'],
  ['slack', 'Slack'],
  ['hubspot', 'HubSpot (public app)'],
  ['outlook', 'Microsoft Outlook / Microsoft Graph (Entra ID app registration)'],
  ['gmail', 'Gmail (Google Cloud OAuth client, Gmail API)'],
  ['salesforce', 'Salesforce (Connected App / External Client App)'],
  ['shopify', 'Shopify (public app)'],
  ['docusign', 'DocuSign eSignature API'],
  ['xero', 'Xero'],
  ['linkedin', 'LinkedIn API'],
  ['spotify', 'Spotify Web API'],
  ['workday', 'Workday'],
];

const args = process.argv.slice(2);
const jobs = args.length ? DEFAULT_SET.filter(([s]) => args.includes(s)).concat(args.filter((a) => !DEFAULT_SET.some(([s]) => s === a)).map((a) => [undefined, a])) : DEFAULT_SET;
const CONCURRENCY = Number(process.env.LIB_CONCURRENCY || 4);

let i = 0;
const results = [];
async function worker() {
  while (i < jobs.length) {
    const [slug, input] = jobs[i++];
    const t = Date.now();
    try {
      const g = await generateGuide(input, (e) => {
        if (['stage', 'probe', 'done'].includes(e.type)) console.log(`[${slug || input}] ${e.type}: ${e.message || e.summary || e.slug || ''}`);
      }, { slug });
      fs.mkdirSync(config.libraryDir, { recursive: true });
      fs.writeFileSync(path.join(config.libraryDir, `${g.slug}.json`), JSON.stringify(g, null, 2));
      results.push(`${g.slug}: ${g.score.label} (${g.score.total}) · confidence ${g.confidence.level} · ${Math.round((Date.now() - t) / 1000)}s`);
    } catch (e) {
      results.push(`${slug || input}: FAILED ${e.message}`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log('\n' + results.join('\n'));
