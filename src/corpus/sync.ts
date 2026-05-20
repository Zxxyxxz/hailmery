// Markdown-only ingestion for V0.
//
// Reads corpus/{tenant_slug}/*.md, chunks at 512/64, embeds via OpenAI,
// upserts into marketing.documents + marketing.document_chunks. Re-running
// the sync supersedes old chunks for any document whose file content has
// changed and replaces them with freshly embedded chunks.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import type { NeonDatabase } from 'drizzle-orm/neon-serverless';
import { chunkMarkdown } from './chunker.js';
import { embedBatch } from './embedder.js';
import { withTenantDb } from '../lib/tenant.js';
import { documents, documentChunks } from '../db/schema.js';
import { and, eq } from 'drizzle-orm';

export interface SyncResult {
  files: number;
  chunksInserted: number;
  documentsUpserted: number;
  skipped: string[];
}

export async function syncCorpus(opts: {
  db: NeonDatabase<Record<string, unknown>>;
  tenantId: string;
  tenantSlug: string;
  corpusRoot?: string;
}): Promise<SyncResult> {
  const corpusRoot = opts.corpusRoot ?? join(process.cwd(), 'corpus', opts.tenantSlug);

  let files: string[];
  try {
    files = (await readdir(corpusRoot)).filter((f) => f.endsWith('.md'));
  } catch {
    return { files: 0, chunksInserted: 0, documentsUpserted: 0, skipped: [`no corpus dir at ${corpusRoot}`] };
  }

  if (files.length === 0) {
    return { files: 0, chunksInserted: 0, documentsUpserted: 0, skipped: ['no .md files'] };
  }

  let totalChunks = 0;
  let totalDocs = 0;
  const skipped: string[] = [];

  for (const file of files) {
    const full = join(corpusRoot, file);
    const content = (await readFile(full, 'utf-8')).trim();
    if (!content) {
      skipped.push(file);
      continue;
    }

    const chunks = chunkMarkdown(content);
    const embeddings = await embedBatch(chunks);

    await withTenantDb(opts.db, opts.tenantId, async (tx) => {
      // Upsert document
      const docRes = await tx
        .insert(documents)
        .values({
          tenantId: opts.tenantId,
          source: 'git',
          sourceFilename: file,
          documentType: 'product_doc',
          r2Key: `git://${opts.tenantSlug}/${file}`,
          mimeType: 'text/markdown',
          version: 1,
        })
        .onConflictDoUpdate({
          target: [documents.tenantId, documents.sourceFilename],
          set: {
            version: sql`${documents.version} + 1`,
            ingestedAt: sql`now()`,
          },
        })
        .returning({ id: documents.id });

      const documentId = docRes[0].id;

      // Mark old chunks as superseded
      await tx
        .update(documentChunks)
        .set({ superseded: true })
        .where(and(eq(documentChunks.documentId, documentId), eq(documentChunks.superseded, false)));

      // Insert new chunks
      await tx.insert(documentChunks).values(
        chunks.map((chunkText, idx) => ({
          tenantId: opts.tenantId,
          documentId,
          chunkIndex: idx,
          chunkText,
          embedding: embeddings[idx],
          sectionTitle: null,
          superseded: false,
        }))
      );
    });

    totalDocs += 1;
    totalChunks += chunks.length;
    console.log(`[corpus] ${file}: ${chunks.length} chunks`);
  }

  return { files: files.length, chunksInserted: totalChunks, documentsUpserted: totalDocs, skipped };
}
