// Hailmery Dashboard — "after redesign" screenshot capture.
// Mirrors scripts/take-screenshots.mjs but writes to screenshots/after/ and adds
// a mobile drawer-open shot + handles the new tab count badges. Run AFTER the
// final deploy:  node scripts/take-screenshots-after.mjs
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_BASE = path.join(__dirname, '..', 'screenshots', 'after');
const BASE_URL = 'https://hailmery-dashboard.pages.dev';
const TENANT_ID = '6daebc34-7fd0-4542-8527-cfcd125a5f72';
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

const KILL = `*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;transition-delay:0s!important;scroll-behavior:auto!important}`;

async function settle(page, vp, timeout = 12000) {
  try { await page.waitForLoadState('networkidle', { timeout }); } catch {}
  try { await page.evaluate(() => document.fonts && document.fonts.ready); } catch {}
  try { await page.waitForFunction(() => !document.querySelector('.animate-pulse'), { timeout: 6000 }); } catch {}
  try { await page.addStyleTag({ content: KILL }); } catch {}
  await page.waitForTimeout(vp === 'mobile' ? 1100 : 800);
}

const storage = () => ({ cookies: [], origins: [{ origin: BASE_URL, localStorage: [{ name: 'hm_tenant_id', value: TENANT_ID }] }] });

async function shot(page, dir, name, full = true) {
  fs.mkdirSync(dir, { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(150);
  const file = path.join(dir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: full, animations: 'disabled', caret: 'hide' });
  console.log('  ✓', `${name}.png`);
}

async function main() {
  const browser = await chromium.launch({ headless: true });

  // ── DESKTOP ──
  console.log('\n📸 DESKTOP 1440×900');
  const dctx = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 2, reducedMotion: 'reduce', storageState: storage() });
  const p = await dctx.newPage();
  const go = async (u) => { await p.goto(u, { waitUntil: 'domcontentloaded' }); await settle(p, 'desktop'); };

  await go(`${BASE_URL}/queue`);
  await shot(p, path.join(OUTPUT_BASE, 'queue'), '01-pending', false);
  // Click tabs by accessible name STARTING WITH the label (count badge follows it;
  // stat-bar buttons start with the number, so /^Label/ uniquely hits the tab).
  for (const [idx, label] of [['02', 'Approved'], ['03', 'Failed']]) {
    try {
      await p.getByRole('tab', { name: new RegExp('^' + label) }).first().click({ timeout: 6000 });
      await p.waitForTimeout(500); await settle(p, 'desktop');
      await shot(p, path.join(OUTPUT_BASE, 'queue'), `${idx}-${label.toLowerCase()}`, false);
    } catch (e) { console.log(`  ⚠ tab ${label}: ${e.message}`); }
  }

  for (const [route, name] of [['/calendar', 'calendar'], ['/campaigns', 'campaigns'], ['/analytics', 'analytics']]) {
    await go(`${BASE_URL}${route}`);
    await shot(p, path.join(OUTPUT_BASE, name), `01-${name}`);
  }
  for (const tab of ['platforms', 'brand', 'corpus']) {
    await go(`${BASE_URL}/settings?tab=${tab}`);
    await shot(p, path.join(OUTPUT_BASE, 'settings'), `01-${tab}`);
  }
  await dctx.close();

  // ── MOBILE ──
  console.log('\n📸 MOBILE 390×844');
  const mctx = await browser.newContext({ viewport: MOBILE, deviceScaleFactor: 3, isMobile: true, hasTouch: true, reducedMotion: 'reduce', storageState: storage() });
  const m = await mctx.newPage();
  const mgo = async (u) => { await m.goto(u, { waitUntil: 'domcontentloaded' }); await settle(m, 'mobile'); };

  await mgo(`${BASE_URL}/queue`);
  await shot(m, path.join(OUTPUT_BASE, 'mobile'), '01-queue', false);
  // Open the drawer via the hamburger (aria-label "Open menu").
  try {
    await m.getByRole('button', { name: 'Open menu' }).click({ timeout: 5000 });
    await m.waitForTimeout(500);
    await shot(m, path.join(OUTPUT_BASE, 'mobile'), '02-drawer-open', false);
    // close it
    await m.mouse.click(360, 400).catch(() => {});
    await m.waitForTimeout(300);
  } catch (e) { console.log('  ⚠ drawer:', e.message); }

  for (const [route, name] of [['/calendar', '03-calendar'], ['/analytics', '04-analytics'], ['/campaigns', '05-campaigns'], ['/settings?tab=platforms', '06-settings-platforms']]) {
    await mgo(`${BASE_URL}${route}`);
    await shot(m, path.join(OUTPUT_BASE, 'mobile'), name, false);
  }
  await mctx.close();
  await browser.close();
  console.log('\n✅ after-screenshots →', OUTPUT_BASE);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
