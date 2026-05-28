// Symmetric encryption for tenant platform tokens stored in
// marketing.tenant_secrets.encrypted_access_token.
//
// Format: `base64(iv):base64(ciphertext)` where iv is a 12-byte AES-GCM nonce.
// The key is a base64-encoded 32-byte value supplied via env.SECRETS_KEY.
// Web Crypto is available in both the Worker runtime and Node 22+.

const ALGO = 'AES-GCM';
const IV_BYTES = 12;

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function importKey(keyB64: string): Promise<CryptoKey> {
  const raw = b64ToBytes(keyB64);
  if (raw.length !== 32) {
    throw new Error('SECRETS_KEY must decode to 32 bytes (AES-256)');
  }
  return crypto.subtle.importKey('raw', raw, { name: ALGO }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function encryptSecret(
  plaintext: string,
  keyB64: string,
): Promise<string> {
  const key = await importKey(keyB64);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = await crypto.subtle.encrypt(
    { name: ALGO, iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `${bytesToB64(iv)}:${bytesToB64(new Uint8Array(ct))}`;
}

export async function decryptSecret(
  ciphertext: string,
  keyB64: string,
): Promise<string> {
  const [ivB64, ctB64] = ciphertext.split(':');
  if (!ivB64 || !ctB64) {
    throw new Error('malformed ciphertext (expected iv:ciphertext)');
  }
  const key = await importKey(keyB64);
  const pt = await crypto.subtle.decrypt(
    { name: ALGO, iv: b64ToBytes(ivB64) },
    key,
    b64ToBytes(ctB64),
  );
  return new TextDecoder().decode(pt);
}
