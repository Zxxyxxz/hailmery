// Scheduled jobs, invoked from the Worker `scheduled` handler (see wrangler.toml
// cron triggers).

import { makeDb } from '../db/client.js';
import { getAllActiveTenants, hasPlatformSecret } from '../lib/tenant.js';
import {
  syncContactsToSendGrid,
  resolveMailSyncDeps,
  type MailSyncEnv,
} from '../services/mailsync.js';

// Runs the HubSpot -> SendGrid contact sync for every tenant that has both
// platforms connected. Cron: `0 */6 * * *`.
export async function runMailSync(env: MailSyncEnv): Promise<void> {
  const db = makeDb(env.DATABASE_URL);
  const tenants = await getAllActiveTenants(db);

  for (const tenant of tenants) {
    const [hasHubSpot, hasSendGrid] = await Promise.all([
      hasPlatformSecret(db, tenant.id, 'hubspot'),
      hasPlatformSecret(db, tenant.id, 'sendgrid'),
    ]);
    if (!hasHubSpot || !hasSendGrid) continue;

    try {
      const deps = await resolveMailSyncDeps(env, tenant.id);
      await syncContactsToSendGrid(tenant.id, deps);
    } catch (err) {
      console.error(
        `[mailsync] tenant ${tenant.id} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}
