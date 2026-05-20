import { openai, MODELS } from '../lib/ai.js';

// OpenAI embeddings batch endpoint accepts up to 2048 inputs per call.
// We chunk our inputs at 100 to stay well within request-body limits.
const BATCH = 100;

export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const out: number[][] = [];
  const client = openai();
  for (let i = 0; i < texts.length; i += BATCH) {
    const slice = texts.slice(i, i + BATCH);
    const res = await client.embeddings.create({
      model: MODELS.EMBED,
      input: slice,
    });
    for (const d of res.data) out.push(d.embedding);
  }
  return out;
}

export async function embedOne(text: string): Promise<number[]> {
  const [v] = await embedBatch([text]);
  return v;
}
