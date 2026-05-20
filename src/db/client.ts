import { drizzle } from 'drizzle-orm/neon-serverless';
import { Pool } from '@neondatabase/serverless';
import * as schema from './schema.js';

// Node 22+ ships a native WebSocket global. Cloudflare Workers ships its own.
// The Neon serverless driver picks up `globalThis.WebSocket` automatically in
// both runtimes — no extra wiring needed.

function makePool(connectionString: string) {
  return new Pool({ connectionString });
}

export function makeDb(connectionString: string) {
  return drizzle(makePool(connectionString), { schema });
}

// Default singleton for Node CLI scripts. The Worker creates its own per-request.
export const db = makeDb(process.env.DATABASE_URL ?? '');

export { schema };
