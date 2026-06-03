// Object storage for uploaded corpus documents.
//
// In the Worker (incl. `wrangler dev`, which simulates R2) the bound R2 bucket
// is used. When the binding is absent — e.g. a plain Node process driving the
// pipeline without a Worker runtime — we fall back to local disk under
// out/uploads/<key> so upload → reingest → delete stay symmetric by key.

const LOCAL_ROOT = 'out/uploads';

function localPathFor(key: string): string {
  // Keys are slash-delimited (corpus/{tenant}/{doc}/{file}); mirror them under
  // the local root so get/delete resolve the same object put() wrote.
  return `${LOCAL_ROOT}/${key}`;
}

/** Store bytes at `key`. Uses R2 when bound, else local disk (with a warning). */
export async function putObject(
  r2: R2Bucket | undefined,
  key: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  if (r2) {
    await r2.put(key, bytes, { httpMetadata: { contentType } });
    return;
  }
  console.warn(`[storage] R2 binding unavailable — writing ${key} to local ${LOCAL_ROOT}/`);
  const { writeFile, mkdir } = await import('node:fs/promises');
  const { dirname } = await import('node:path');
  const path = localPathFor(key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

/** Read bytes for `key`, or null if the object does not exist. */
export async function getObject(
  r2: R2Bucket | undefined,
  key: string,
): Promise<Uint8Array | null> {
  if (r2) {
    const obj = await r2.get(key);
    if (!obj) return null;
    return new Uint8Array(await obj.arrayBuffer());
  }
  const { readFile } = await import('node:fs/promises');
  try {
    const buf = await readFile(localPathFor(key));
    return new Uint8Array(buf);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    throw err;
  }
}

/** Delete `key`. Best-effort: a missing object is not an error. */
export async function deleteObject(
  r2: R2Bucket | undefined,
  key: string,
): Promise<void> {
  if (r2) {
    await r2.delete(key);
    return;
  }
  const { unlink } = await import('node:fs/promises');
  try {
    await unlink(localPathFor(key));
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
  }
}
