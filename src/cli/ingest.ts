// CLI: pnpm ingest --tenant apire
//
// Re-runs the markdown ingestion pipeline for a tenant. Idempotent — old
// chunks are marked superseded, fresh chunks replace them.

import { db } from '../db/client.js';
import { syncCorpus } from '../corpus/sync.js';
import { findTenantBySlug } from '../lib/tenant.js';

async function main() {
  const args = process.argv.slice(2);
  const slugIdx = args.indexOf('--tenant');
  if (slugIdx === -1 || !args[slugIdx + 1]) {
    console.error('Usage: pnpm ingest --tenant <slug>');
    process.exit(1);
  }
  const slug = args[slugIdx + 1];

  const tenant = await findTenantBySlug(db, slug);
  if (!tenant) {
    console.error(`No tenant with slug '${slug}'. Run \`pnpm db:seed\` first.`);
    process.exit(1);
  }

  console.log(`[ingest] tenant=${tenant.name} (${tenant.id})`);
  const result = await syncCorpus({
    db,
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
  });

  console.log('[ingest] result:', result);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
