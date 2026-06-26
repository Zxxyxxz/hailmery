// Seed the dashboard login allow-list (marketing.users) — session 14 JWT auth.
//
//   node scripts/seed-users.mjs
//
// Idempotent: ON CONFLICT (email) updates the name + allowed tenants in place, so
// it's safe to re-run. Connects with .env DATABASE_URL (admin role). Emails are
// stored lowercase to match the login callback's lookup.
import { config } from 'dotenv';
config();
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

const APIRE_TENANT = '6daebc34-7fd0-4542-8527-cfcd125a5f72';
const OSM_TENANT = '4cc53768-a7c3-4869-8250-f73b244ca315';

const users = [
  {
    email: 'bezekyigit0@gmail.com', // Yigit — developer, sees both tenants
    name: 'Yigit Bezek',
    allowedTenantIds: [APIRE_TENANT, OSM_TENANT],
  },
  {
    email: 'baran.erdogan@kuzeyinc.com', // Baran — client, owns both tenants
    name: 'Baran Erdogan',
    allowedTenantIds: [APIRE_TENANT, OSM_TENANT],
  },
  {
    email: 'ybbezo@gmail.com', // Yigit's alt Google account (OAuth testing)
    name: 'Yigit Bezek (alt)',
    allowedTenantIds: [APIRE_TENANT, OSM_TENANT],
  },
];

for (const user of users) {
  // Bind the uuid[] as an explicit array literal + ::uuid[] cast — deterministic
  // across the neon HTTP driver regardless of how it serializes JS arrays.
  const tenantArray = `{${user.allowedTenantIds.join(',')}}`;
  const rows = await sql`
    INSERT INTO marketing.users (email, name, allowed_tenant_ids)
    VALUES (${user.email.toLowerCase()}, ${user.name}, ${tenantArray}::uuid[])
    ON CONFLICT (email) DO UPDATE
      SET name = EXCLUDED.name,
          allowed_tenant_ids = EXCLUDED.allowed_tenant_ids
    RETURNING id, email, allowed_tenant_ids
  `;
  console.log('Seeded:', rows[0]);
}

process.exit(0);
