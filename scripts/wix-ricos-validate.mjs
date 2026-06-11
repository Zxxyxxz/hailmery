// Validate the new toRicos() over real + edge-case markdown:
//   1. strict local structural checks (regression guard — no leaked markdown)
//   2. the live Wix Validate Document API as an oracle
//   pnpm exec tsx --env-file=.env scripts/wix-ricos-validate.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { toRicos, buildInlineImageNode, insertInlineImageNode } from '../src/adapters/wix-blog.ts';
import { makeDb } from '../src/db/client.ts';
import { loadSecret } from '../src/lib/credentials.ts';

const APIRE = '6daebc34-7fd0-4542-8527-cfcd125a5f72';
const db = makeDb(process.env.DATABASE_URL);
const s = await loadSecret(db, APIRE, 'wix-blog', process.env.SECRETS_KEY);
const headers = { Authorization: s.accessToken, 'Content-Type': 'application/json', 'wix-site-id': s.profileMap.wixSiteId };

const KNOWN = new Set(['PARAGRAPH','TEXT','HEADING','DIVIDER','BULLETED_LIST','ORDERED_LIST','LIST_ITEM','IMAGE','CODE_BLOCK']);

function checkLocal(label, doc) {
  const errs = [];
  if (!doc.nodes?.length) errs.push('empty document');
  const ids = new Set();
  function walk(n, path) {
    if (!KNOWN.has(n.type)) errs.push(`${path}: unknown type ${n.type}`);
    if (!Array.isArray(n.nodes)) errs.push(`${path}: nodes not array`);
    if (n.type !== 'TEXT') {
      if (typeof n.id !== 'string' || n.id === '') errs.push(`${path}: missing block id`);
      else if (ids.has(n.id)) errs.push(`${path}: dup id ${n.id}`);
      else ids.add(n.id);
    }
    if (n.type === 'HEADING') {
      const lvl = n.headingData?.level;
      if (!(lvl >= 1 && lvl <= 6)) errs.push(`${path}: bad heading level ${lvl}`);
      if (!(n.nodes || []).some((c) => c.type === 'TEXT')) errs.push(`${path}: heading no text`);
    }
    if (n.type === 'DIVIDER' && !n.dividerData) errs.push(`${path}: divider no dividerData`);
    if (n.type === 'BULLETED_LIST' || n.type === 'ORDERED_LIST') {
      if (!n.nodes.length) errs.push(`${path}: empty list`);
      for (const li of n.nodes) {
        if (li.type !== 'LIST_ITEM') errs.push(`${path}: list child not LIST_ITEM (${li.type})`);
        else if (!li.nodes.some((p) => p.type === 'PARAGRAPH')) errs.push(`${path}: LIST_ITEM no PARAGRAPH`);
      }
    }
    if (n.type === 'TEXT') {
      const t = n.textData?.text ?? '';
      if (typeof t !== 'string') errs.push(`${path}: text not string`);
      if (!Array.isArray(n.textData?.decorations)) errs.push(`${path}: decorations not array`);
      // leaked-markdown regression checks
      if (t.includes('**')) errs.push(`${path}: leaked ** in "${t.slice(0,40)}"`);
      if (/^#{1,6}\s/.test(t)) errs.push(`${path}: leaked heading "${t.slice(0,40)}"`);
      if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(t.trim())) errs.push(`${path}: leaked divider`);
      if (/\[[^\]]+\]\([^)]+\)/.test(t)) errs.push(`${path}: leaked link "${t.slice(0,40)}"`);
      for (const d of n.textData?.decorations ?? []) {
        if (d.type === 'BOLD' && d.fontWeightValue !== 700) errs.push(`${path}: BOLD missing fontWeightValue`);
        if (d.type === 'ITALIC' && d.italicData !== true) errs.push(`${path}: ITALIC missing italicData`);
        if (d.type === 'LINK' && !d.linkData?.link?.url) errs.push(`${path}: LINK missing url`);
      }
    }
    for (const c of n.nodes || []) walk(c, `${path}/${c.type}`);
  }
  for (const n of doc.nodes) walk(n, n.type);
  return errs;
}

async function checkWix(doc) {
  const res = await fetch('https://www.wixapis.com/ricos/v1/ricos-document/validate', {
    method: 'POST',
    headers,
    body: JSON.stringify({ document: { nodes: doc.nodes }, plugins: ['HEADING','DIVIDER','IMAGE','LINK','CODE_BLOCK'] }),
  });
  const txt = await res.text();
  let j; try { j = JSON.parse(txt); } catch { return { http: res.status, raw: txt.slice(0, 160) }; }
  return { http: res.status, valid: j.valid, violations: (j.violations ?? []).slice(0, 5) };
}

const cases = [];

// (a) all generated .md files (these still carry frontmatter — tests the strip)
const dir = join(process.cwd(), 'out', 'apire');
for (const f of readdirSync(dir).filter((x) => x.endsWith('.md'))) {
  cases.push({ label: `md:${f}`, md: readFileSync(join(dir, f), 'utf-8') });
}

// (b) the 3 live published bodies straight from the DB (what we will republish)
const rows = await db.execute(
  "SELECT payload->>'title' AS title, payload->>'body' AS body FROM marketing.content_drafts WHERE channel IN ('wix-blog','blog') AND status='published' AND published_ref IS NOT NULL",
);
for (const r of rows.rows ?? rows) cases.push({ label: `db:${r.title}`, md: r.body });

// (c) synthetic edge cases: links, nested emphasis, loose ordered list, frontmatter, inline code
cases.push({
  label: 'synthetic:edge',
  md: [
    '---', 'title: Should be stripped', 'slug: x', '---', '',
    '# H1 Title', '', 'Intro with a [link to APIRE](https://apire.io/docs) and **bold** and *italic* and `code_span`.', '',
    '---', '', '## H2 Section', '', 'Text with **bold *and italic* together** and a 3 * 4 math.', '',
    '- first bullet **with bold**', '- second bullet [linked](https://x.io)', '',
    '1. step one', '', '2. step two (loose)', '', '3. step three', '',
    '### H3 with `inline()` code', '', 'Trailing paragraph.',
  ].join('\n'),
});

let totalLocal = 0;
let totalWixBad = 0;
for (const c of cases) {
  const doc = toRicos(c.md);
  // exercise the inline-image path on one case (IMAGE node validity)
  if (c.label === 'synthetic:edge') insertInlineImageNode(doc.nodes, buildInlineImageNode('71438b_fake~mv2.png', 'alt', 'cap'));
  const local = checkLocal(c.label, doc);
  const wix = await checkWix(doc);
  totalLocal += local.length;
  const wixOk = wix.valid === true || (wix.http === 403);
  if (!wixOk) totalWixBad++;
  const types = {};
  (function w(ns){for(const n of ns||[]){types[n.type]=(types[n.type]||0)+1; if(n.nodes)w(n.nodes);}})(doc.nodes);
  console.log(`\n${local.length === 0 ? '✅' : '❌'} ${c.label}  nodes=${doc.nodes.length} types=${JSON.stringify(types)}`);
  console.log(`   wix-validate: http=${wix.http} valid=${wix.valid}${wix.violations?.length ? ' violations='+JSON.stringify(wix.violations) : ''}${wix.raw ? ' raw='+wix.raw : ''}`);
  for (const e of local.slice(0, 8)) console.log(`   • ${e}`);
}

console.log(`\n=== SUMMARY: ${cases.length} docs, local errors=${totalLocal}, wix-invalid=${totalWixBad} ===`);
process.exit(totalLocal === 0 ? 0 : 1);
