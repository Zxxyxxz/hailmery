// Shared chunk → embed → upsert logic for the document upload pipeline.
//
// Both POST /documents/upload and POST /documents/:id/reingest call this:
//   1. embedChunks(text)        — chunk at 512/64 + embed via OpenAI (no tx held)
//   2. replaceDocumentChunks(tx) — supersede old chunks, insert the fresh ones
//
// Embedding is a slow network call, so it runs OUTSIDE the tenant transaction;
// only the (fast) supersede + insert run inside it. Mirrors corpus/sync.ts but
// works off in-memory text instead of the filesystem.

import { sql } from 'drizzle-orm';
import { chunkMarkdown } from './chunker.js';
import { embedBatch } from './embedder.js';
import { documentChunks } from '../db/schema.js';
import { and, eq } from 'drizzle-orm';

export interface EmbeddedChunks {
  chunks: string[];
  embeddings: number[][];
}

/** Chunk + embed text. Returns empty arrays for blank input. */
export async function embedChunks(text: string): Promise<EmbeddedChunks> {
  const trimmed = text.trim();
  if (!trimmed) return { chunks: [], embeddings: [] };

  const chunks = chunkMarkdown(trimmed);
  const embeddings = await embedBatch(chunks);

  // Fail loudly on a bad embedding rather than writing NaNs the vector index
  // can't compare against (same guard generation/context.ts applies on read).
  for (const emb of embeddings) {
    if (emb.length !== 1536 || !emb.every((n) => Number.isFinite(n))) {
      throw new Error('embedding contained non-finite values or wrong dimension');
    }
  }
  return { chunks, embeddings };
}

// Drizzle's transaction handle type, derived the same way lib/tenant.ts does.
type Tx = Parameters<
  Parameters<
    import('drizzle-orm/neon-serverless').NeonDatabase<Record<string, unknown>>['transaction']
  >[0]
>[0];

/**
 * Within an already-tenant-scoped transaction: mark the document's existing
 * live chunks superseded, then insert the freshly embedded ones. Returns the
 * number of chunks inserted.
 */
export async function replaceDocumentChunks(
  tx: Tx,
  opts: {
    tenantId: string;
    documentId: string;
    chunks: string[];
    embeddings: number[][];
  },
): Promise<number> {
  const { tenantId, documentId, chunks, embeddings } = opts;

  await tx
    .update(documentChunks)
    .set({ superseded: true })
    .where(
      and(eq(documentChunks.documentId, documentId), eq(documentChunks.superseded, false)),
    );

  if (chunks.length === 0) return 0;

  const rows = chunks.map((chunkText, idx) => {
    const vec = sql.raw(`'[${embeddings[idx].join(',')}]'::vector`);
    return sql`(${tenantId}, ${documentId}, ${idx}, ${chunkText}, ${vec}, ${null}, false)`;
  });

  await tx.execute(sql`
    INSERT INTO marketing.document_chunks
      (tenant_id, document_id, chunk_index, chunk_text, embedding, section_title, superseded)
    VALUES ${sql.join(rows, sql`, `)}
  `);

  return chunks.length;
}
