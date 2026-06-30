// Hailmery Dashboard Screenshot Generator
// ----------------------------------------
// Captures every page + state of the hailmery dashboard (desktop + mobile) for
// use as visual documentation feeding a frontend redesign.
//
// Design notes (why this differs from a naive screenshot loop):
//   • deviceScaleFactor 2/3  → retina-sharp text that survives downscaling.
//   • reducedMotion + CSS kill + animations:'disabled' → deterministic frames,
//     never caught mid `animate-fade-in`.
//   • waits for document.fonts.ready and for skeleton (.animate-pulse) loaders to
//     clear → real content, not spinners.
//   • Settings tabs are reached via ?tab= deep-links (the page honours them) and
//     ALL FIVE tabs are captured (brand/platforms/corpus/history/schedule).
//   • Queue tabs (no URL state) are reached by clicking role="tab" triggers.
//   • Long pages are segmented by scrolling the window and shooting the viewport
//     (no fragile clip math), with slight overlap and a logged per-state cap so
//     the 100+ repeating draft cards don't explode into dozens of identical PNGs.
//   • A whole-page overview PNG is also produced for pages under FULL_MAX.
//   • Console errors / failed requests are recorded into screenshots/manifest.json.

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_BASE = path.join(__dirname, '..', 'screenshots');

const BASE_URL = 'https://hailmery-dashboard.pages.dev';
const TENANT_ID = '6daebc34-7fd0-4542-8527-cfcd125a5f72';

const DESKTOP_VIEWPORT = { width: 1440, height: 900 };
const MOBILE_VIEWPORT = { width: 390, height: 844 };

const SEGMENT_OVERLAP = 70;     // px overlap between vertical slices
const SEGMENT_CAP = 14;         // max slices per state (repeating cards → capped)
const FULL_MAX_HEIGHT = 14000;  // skip single full-page overview above this height
const SHORT_FACTOR = 1.25;      // page <= viewport*this → one shot is enough

const manifest = {
  baseUrl: BASE_URL,
  tenantId: TENANT_ID,
  generatedAt: new Date().toISOString(),
  targets: [],
};

const KILL_ANIMATIONS_CSS = `
  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
    scroll-behavior: auto !important;
  }
`;

// ── wait helpers ───────────────────────────────────────────────────────────
async function settle(page, viewport, timeout = 12000) {
  try { await page.waitForLoadState('networkidle', { timeout }); } catch (_) {}
  // Web fonts loaded → no fallback-font blur.
  try { await page.evaluate(() => document.fonts && document.fonts.ready); } catch (_) {}
  // Skeleton loaders gone → real content, not a spinner.
  try {
    await page.waitForFunction(
      () => !document.querySelector('.animate-pulse'),
      { timeout: 6000 },
    );
  } catch (_) {}
  // Re-inject the animation kill switch (survives client-side route swaps).
  try { await page.addStyleTag({ content: KILL_ANIMATIONS_CSS }); } catch (_) {}
  await page.waitForTimeout(viewport === 'mobile' ? 1200 : 900);
}

async function pageHeight(page) {
  return page.evaluate(() =>
    Math.max(
      document.documentElement.scrollHeight,
      document.body ? document.body.scrollHeight : 0,
    ),
  );
}

const SHOT_OPTS = { animations: 'disabled', caret: 'hide' };

// Capture a single state. Produces either one shot (short pages) or overlapping
// viewport slices (tall pages) plus an optional whole-page overview.
async function captureState(page, { dir, basename, key, label, url, viewport }) {
  fs.mkdirSync(dir, { recursive: true });
  const entry = {
    key, label, url, viewport,
    files: [], scrollHeight: null, status: 'ok', notes: [],
    consoleErrors: [], failedRequests: [],
  };

  try {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(150);
    const vh = viewport === 'mobile' ? MOBILE_VIEWPORT.height : DESKTOP_VIEWPORT.height;
    const vw = viewport === 'mobile' ? MOBILE_VIEWPORT.width : DESKTOP_VIEWPORT.width;
    const height = await pageHeight(page);
    entry.scrollHeight = height;

    if (height <= vh * SHORT_FACTOR) {
      // Short page → one crisp full-page shot.
      const file = path.join(dir, `${basename}.png`);
      await page.screenshot({ path: file, fullPage: true, ...SHOT_OPTS });
      entry.files.push({ name: `${basename}.png`, kind: 'single', wLogical: vw, hLogical: height });
      console.log(`  ✓ ${basename}.png (${height}px, single)`);
    } else {
      // Tall page → overview (if not enormous) + overlapping viewport slices.
      if (height <= FULL_MAX_HEIGHT) {
        const ffile = path.join(dir, `${basename}-full.png`);
        await page.screenshot({ path: ffile, fullPage: true, ...SHOT_OPTS });
        entry.files.push({ name: `${basename}-full.png`, kind: 'full', wLogical: vw, hLogical: height });
        console.log(`  ✓ ${basename}-full.png (${height}px overview)`);
      } else {
        entry.notes.push(`overview skipped — page ${height}px exceeds ${FULL_MAX_HEIGHT}px cap`);
      }

      const step = vh - SEGMENT_OVERLAP;
      const neededSlices = Math.ceil(height / step);
      const slices = Math.min(neededSlices, SEGMENT_CAP);
      if (neededSlices > SEGMENT_CAP) {
        entry.notes.push(
          `captured ${SEGMENT_CAP}/${neededSlices} slices (capped — covers ~${slices * step}px of ${height}px; tail is repeating cards)`,
        );
        console.log(`  ⓘ capping at ${SEGMENT_CAP}/${neededSlices} slices for ${basename}`);
      }

      for (let i = 0; i < slices; i++) {
        const y = Math.min(i * step, Math.max(0, height - vh));
        await page.evaluate((yy) => window.scrollTo(0, yy), y);
        await page.waitForTimeout(viewport === 'mobile' ? 350 : 280);
        const name = `${basename}-part${i + 1}.png`;
        await page.screenshot({ path: path.join(dir, name), fullPage: false, ...SHOT_OPTS });
        entry.files.push({ name, kind: 'slice', scrollY: y, wLogical: vw, hLogical: vh });
        console.log(`  ✓ ${name} (y=${y}px)`);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
    }
  } catch (e) {
    entry.status = 'error';
    entry.notes.push(`capture failed: ${e.message}`);
    console.log(`  ✗ ${basename}: ${e.message}`);
  }
  return entry;
}

// Attach console / network-failure listeners that drain into the "current" buckets.
function wireDiagnostics(page, getBuckets) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const b = getBuckets();
      if (b) b.consoleErrors.push(msg.text().slice(0, 300));
    }
  });
  page.on('requestfailed', (req) => {
    const b = getBuckets();
    if (b) b.failedRequests.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText ?? '?'}`.slice(0, 300));
  });
  page.on('response', (resp) => {
    if (resp.status() >= 400) {
      const b = getBuckets();
      if (b) b.failedRequests.push(`HTTP ${resp.status()} ${resp.url()}`.slice(0, 300));
    }
  });
}

const storageStateFor = () => ({
  cookies: [],
  origins: [{ origin: BASE_URL, localStorage: [{ name: 'hm_tenant_id', value: TENANT_ID }] }],
});

async function main() {
  const browser = await chromium.launch({ headless: true });

  // ───────────────────────── DESKTOP ─────────────────────────
  console.log('\n📸 DESKTOP (1440×900 @2x)');
  const desktopCtx = await browser.newContext({
    viewport: DESKTOP_VIEWPORT,
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
    storageState: storageStateFor(),
  });
  const page = await desktopCtx.newPage();
  let currentBuckets = null;
  wireDiagnostics(page, () => currentBuckets);

  const go = async (url) => {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await settle(page, 'desktop');
  };

  const run = async (target) => {
    currentBuckets = { consoleErrors: [], failedRequests: [] };
    const entry = await captureState(page, target);
    entry.consoleErrors = currentBuckets.consoleErrors.slice(0, 20);
    entry.failedRequests = currentBuckets.failedRequests.slice(0, 20);
    manifest.targets.push(entry);
  };

  // QUEUE — pending tab on load, then click the other Radix role="tab" triggers.
  console.log('\n• Queue');
  const queueDir = path.join(OUTPUT_BASE, 'queue');
  await go(`${BASE_URL}/queue`);
  await run({ dir: queueDir, basename: '01-pending-tab', key: 'queue:pending', label: 'Queue — Pending', url: `${BASE_URL}/queue`, viewport: 'desktop' });

  for (const [idx, name] of [['02', 'Approved'], ['03', 'Published'], ['04', 'Failed']]) {
    try {
      // Custom Tabs (src/components/ui/tabs.tsx) render a plain <button>, NOT a
      // role="tab" element — so match the trigger by its (exact) button text.
      await page.getByRole('button', { name, exact: true }).first().click({ timeout: 6000 });
      await page.waitForTimeout(400);
      await settle(page, 'desktop');
    } catch (e) {
      console.log(`  ⚠ could not switch to "${name}" tab: ${e.message}`);
    }
    await run({
      dir: queueDir, basename: `${idx}-${name.toLowerCase()}-tab`,
      key: `queue:${name.toLowerCase()}`, label: `Queue — ${name}`,
      url: `${BASE_URL}/queue (#${name})`, viewport: 'desktop',
    });
  }

  // CALENDAR
  console.log('\n• Calendar');
  await go(`${BASE_URL}/calendar`);
  await run({ dir: path.join(OUTPUT_BASE, 'calendar'), basename: '01-calendar', key: 'calendar', label: 'Calendar', url: `${BASE_URL}/calendar`, viewport: 'desktop' });

  // CAMPAIGNS
  console.log('\n• Campaigns');
  await go(`${BASE_URL}/campaigns`);
  await run({ dir: path.join(OUTPUT_BASE, 'campaigns'), basename: '01-campaigns', key: 'campaigns', label: 'Campaigns', url: `${BASE_URL}/campaigns`, viewport: 'desktop' });

  // ANALYTICS
  console.log('\n• Analytics');
  await go(`${BASE_URL}/analytics`);
  await run({ dir: path.join(OUTPUT_BASE, 'analytics'), basename: '01-analytics', key: 'analytics', label: 'Analytics', url: `${BASE_URL}/analytics`, viewport: 'desktop' });

  // SETTINGS — all five tabs via ?tab= deep-links (robust; no clicking).
  console.log('\n• Settings (5 tabs)');
  const settingsDir = path.join(OUTPUT_BASE, 'settings');
  const settingsTabs = [
    ['01-brand-voice-tab', 'brand', 'Brand Voice'],
    ['02-platforms-tab', 'platforms', 'Platforms'],
    ['03-corpus-tab', 'corpus', 'Corpus'],
    ['04-import-history-tab', 'history', 'Import History'],
    ['05-schedule-tab', 'schedule', 'Schedule'],
  ];
  for (const [basename, tab, label] of settingsTabs) {
    const url = `${BASE_URL}/settings?tab=${tab}`;
    await go(url);
    await run({ dir: settingsDir, basename, key: `settings:${tab}`, label: `Settings — ${label}`, url, viewport: 'desktop' });
  }

  await desktopCtx.close();

  // ───────────────────────── MOBILE ─────────────────────────
  console.log('\n📸 MOBILE (390×844 @3x, iPhone 14 Pro)');
  const mobileCtx = await browser.newContext({
    viewport: MOBILE_VIEWPORT,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'reduce',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    storageState: storageStateFor(),
  });
  const mobilePage = await mobileCtx.newPage();
  let mobileBuckets = null;
  wireDiagnostics(mobilePage, () => mobileBuckets);
  const mobileDir = path.join(OUTPUT_BASE, 'mobile');

  const mobileTargets = [
    ['01-queue', '/queue', 'Queue'],
    ['02-calendar', '/calendar', 'Calendar'],
    ['03-campaigns', '/campaigns', 'Campaigns'],
    ['04-analytics', '/analytics', 'Analytics'],
    ['05-settings-brand', '/settings?tab=brand', 'Settings — Brand Voice'],
    ['06-settings-platforms', '/settings?tab=platforms', 'Settings — Platforms'],
  ];
  for (const [basename, route, label] of mobileTargets) {
    console.log(`\n• Mobile ${label}`);
    await mobilePage.goto(`${BASE_URL}${route}`, { waitUntil: 'domcontentloaded' });
    await settle(mobilePage, 'mobile');
    mobileBuckets = { consoleErrors: [], failedRequests: [] };
    const entry = await captureState(mobilePage, {
      dir: mobileDir, basename, key: `mobile:${basename}`, label: `Mobile — ${label}`,
      url: `${BASE_URL}${route}`, viewport: 'mobile',
    });
    entry.consoleErrors = mobileBuckets.consoleErrors.slice(0, 20);
    entry.failedRequests = mobileBuckets.failedRequests.slice(0, 20);
    manifest.targets.push(entry);
  }

  await mobileCtx.close();
  await browser.close();

  // ── manifest + summary ──────────────────────────────────────────────────
  fs.writeFileSync(path.join(OUTPUT_BASE, 'manifest.json'), JSON.stringify(manifest, null, 2));

  let totalFiles = 0;
  console.log('\n✅ Done. Summary:');
  for (const t of manifest.targets) {
    totalFiles += t.files.length;
    const flags = [];
    if (t.status !== 'ok') flags.push('STATUS=' + t.status);
    if (t.consoleErrors.length) flags.push(`${t.consoleErrors.length} console-err`);
    if (t.failedRequests.length) flags.push(`${t.failedRequests.length} req-fail`);
    console.log(`  ${t.label}: ${t.files.length} file(s), ${t.scrollHeight}px${flags.length ? '  [' + flags.join(', ') + ']' : ''}`);
    for (const n of t.notes) console.log(`      note: ${n}`);
  }
  console.log(`\n  ${manifest.targets.length} states, ${totalFiles} PNG files → ${OUTPUT_BASE}`);
  console.log(`  manifest → ${path.join(OUTPUT_BASE, 'manifest.json')}`);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
