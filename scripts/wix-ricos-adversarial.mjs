// Run a JSON array of adversarial markdown strings through toRicos and check
// each: strict local structure + leaked-markdown + the Wix Validate oracle.
//   pnpm exec tsx --env-file=.env scripts/wix-ricos-adversarial.mjs <inputs.json>
import { readFileSync } from 'node:fs';
import { toRicos } from '../src/adapters/wix-blog.ts';
import { makeDb } from '../src/db/client.ts';
import { loadSecret } from '../src/lib/credentials.ts';

const APIRE = '6daebc34-7fd0-4542-8527-cfcd125a5f72';
const db = makeDb(process.env.DATABASE_URL);
const s = await loadSecret(db, APIRE, 'wix-blog', process.env.SECRETS_KEY);
const headers = { Authorization: s.accessToken, 'Content-Type': 'application/json', 'wix-site-id': s.profileMap.wixSiteId };

const KNOWN = new Set(['PARAGRAPH','TEXT','HEADING','DIVIDER','BULLETED_LIST','ORDERED_LIST','LIST_ITEM','IMAGE','CODE_BLOCK']);
function localErrors(doc) {
  const errs = [];
  if (!doc.nodes?.length) errs.push('empty doc');
  const ids = new Set();
  (function walk(ns, path, parent) {
    for (const n of ns ?? []) {
      if (!KNOWN.has(n.type)) errs.push(`${path}: unknown ${n.type}`);
      if (n.type !== 'TEXT') {
        if (typeof n.id !== 'string' || !n.id) errs.push(`${path}: bad id`);
        else if (ids.has(n.id)) errs.push(`${path}: dup id ${n.id}`); else ids.add(n.id);
      }
      if (n.type === 'HEADING' && !(n.headingData?.level >= 1 && n.headingData?.level <= 6)) errs.push(`${path}: bad level`);
      if ((n.type === 'BULLETED_LIST' || n.type === 'ORDERED_LIST')) {
        for (const li of n.nodes) if (li.type !== 'LIST_ITEM') errs.push(`${path}: non-LIST_ITEM`);
      }
      if (n.type === 'TEXT' && parent !== 'CODE_BLOCK') {
        // leaked-markdown checks — skipped inside CODE_BLOCK (verbatim by design)
        const t = n.textData?.text ?? '';
        if (t.includes('**')) errs.push(`leaked ** "${t.slice(0,40)}"`);
        if (/^#{1,6}\s/.test(t)) errs.push(`leaked heading "${t.slice(0,40)}"`);
        if (/\[[^\]]+\]\([^)]+\)/.test(t)) errs.push(`leaked link "${t.slice(0,40)}"`);
        for (const d of n.textData?.decorations ?? []) {
          if (d.type === 'LINK') {
            const u = d.linkData?.link?.url ?? '';
            if (/^\s*(javascript|data|vbscript):/i.test(u)) errs.push(`unsafe link url "${u.slice(0,40)}"`);
          }
        }
      }
      walk(n.nodes, `${path}/${n.type}`, n.type);
    }
  })(doc.nodes, 'root', 'root');
  return errs;
}
async function wixValid(doc) {
  try {
    const res = await fetch('https://www.wixapis.com/ricos/v1/ricos-document/validate', {
      method: 'POST', headers,
      body: JSON.stringify({ document: { nodes: doc.nodes }, plugins: ['HEADING','DIVIDER','IMAGE','LINK','CODE_BLOCK'] }),
    });
    const j = await res.json();
    return { http: res.status, valid: j.valid, violations: (j.violations ?? []).slice(0, 3) };
  } catch (e) { return { error: String(e).slice(0, 80) }; }
}

const inputs = JSON.parse(readFileSync(process.argv[2], 'utf-8'));
let bad = 0;
for (let i = 0; i < inputs.length; i++) {
  const md = inputs[i];
  let doc, threw = null, ms = 0;
  const t0 = Date.now();
  try { doc = toRicos(md); } catch (e) { threw = String(e).slice(0, 120); }
  ms = Date.now() - t0;
  if (threw) { bad++; console.log(`\n❌ [${i}] THREW in ${ms}ms: ${threw}\n   input=${JSON.stringify(md).slice(0,90)}`); continue; }
  const errs = localErrors(doc);
  const wix = await wixValid(doc);
  const ok = errs.length === 0 && (wix.valid === true || wix.http === 403);
  if (!ok || ms > 200) bad++;
  console.log(`\n${ok && ms <= 200 ? '✅' : '❌'} [${i}] ${ms}ms  wix=${wix.valid}${wix.violations?.length ? ' '+JSON.stringify(wix.violations) : ''}`);
  console.log(`   input=${JSON.stringify(md).slice(0, 100)}`);
  errs.slice(0, 6).forEach((e) => console.log(`   • ${e}`));
}
console.log(`\n=== ${inputs.length} adversarial inputs, ${bad} problematic ===`);
process.exit(bad === 0 ? 0 : 1);
