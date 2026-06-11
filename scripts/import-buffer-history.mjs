// Import historical Buffer content (sent posts + real engagement) for one or more
// tenants. Thin CLI over src/jobs/import-buffer.ts — the same logic the dashboard
// endpoint runs. Idempotent: re-running only imports posts not already present.
//
//   # APIRE LinkedIn only
//   pnpm exec tsx --env-file=.env scripts/import-buffer-history.mjs --tenant apire --profiles linkedin
//
//   # APIRE + OSM LinkedIn
//   pnpm exec tsx --env-file=.env scripts/import-buffer-history.mjs --tenant apire,osm --profiles linkedin
//
//   # Dry run (fetch + de-dup + count, no DB writes)
//   pnpm exec tsx --env-file=.env scripts/import-buffer-history.mjs --tenant apire --profiles linkedin --dry-run
//
// Never prints secrets. Runs as the BYPASSRLS db owner; import-buffer.ts carries
// explicit tenant_id predicates on every statement regardless.

import { makeDb } from '../src/db/client.ts';
import { findTenantBySlug } from '../src/lib/tenant.ts';
import { importBufferHistory } from '../src/jobs/import-buffer.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseArgs(argv) {
  const out = { tenant: 'apire', profiles: 'linkedin', dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--tenant') out.tenant = argv[++i];
    else if (a === '--profiles' || a === '--profile') out.profiles = argv[++i];
    else if (a.startsWith('--tenant=')) out.tenant = a.slice('--tenant='.length);
    else if (a.startsWith('--profiles=')) out.profiles = a.slice('--profiles='.length);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const tenantKeys = String(args.tenant).split(',').map((s) => s.trim()).filter(Boolean);
const channels = String(args.profiles).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

const env = {
  DATABASE_URL: process.env.DATABASE_URL,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? '',
  SECRETS_KEY: process.env.SECRETS_KEY ?? '',
};
if (!env.DATABASE_URL) throw new Error('DATABASE_URL not set');
if (!env.SECRETS_KEY) throw new Error('SECRETS_KEY not set');

const db = makeDb(env.DATABASE_URL);

async function resolveTenantId(key) {
  if (UUID_RE.test(key)) return key;
  const t = await findTenantBySlug(db, key);
  if (!t) throw new Error(`no tenant with slug "${key}"`);
  return t.id;
}

console.log(
  `\n${args.dryRun ? '🔍 DRY RUN — ' : ''}Importing Buffer history` +
    `\n  tenants:  ${tenantKeys.join(', ')}` +
    `\n  channels: ${channels.join(', ')}\n`,
);

for (const key of tenantKeys) {
  let tenantId;
  try {
    tenantId = await resolveTenantId(key);
  } catch (e) {
    console.error(`✗ ${key}: ${e.message}`);
    continue;
  }

  console.log(`──────── ${key} (${tenantId}) ────────`);
  const r = await importBufferHistory({ db, env, tenantId, channels, dryRun: args.dryRun });

  for (const ch of r.channels) {
    const label = ch.error ? `ERROR — ${ch.error}` : `fetched ${ch.fetched}, ${args.dryRun ? 'would import' : 'imported'} ${ch.imported}, skipped ${ch.skipped}`;
    console.log(`  ${ch.channel.padEnd(10)} ${label}${ch.channelId ? ` (channel ${ch.channelId})` : ''}`);
  }

  console.log(
    `  ── summary: fetched=${r.fetched} ${args.dryRun ? 'wouldImport' : 'imported'}=${r.imported} ` +
      `skipped=${r.skipped} scored=${r.scored} golden=${r.goldenExamples}`,
  );

  if (r.topPerformers.length) {
    console.log(`  ── top ${r.topPerformers.length} imported performer(s) by score ──`);
    r.topPerformers.forEach((p, i) => {
      const score = p.performanceScore != null ? p.performanceScore.toFixed(3) : 'n/a';
      console.log(`    ${i + 1}. score=${score} impr=${p.impressions} eng=${p.engagement}  "${p.preview}"`);
    });
  }
  console.log('');
}

process.exit(0);
