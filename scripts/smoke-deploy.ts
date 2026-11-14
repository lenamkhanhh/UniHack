import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE_URL = process.argv[2] || 'https://unihack-missionpay-voxelcode.vercel.app';
const OUT_DIR = path.resolve(__dirname, '../artifacts/submission-s1/deploy-smoke');

async function checkApi(name: string, url: string, options?: RequestInit) {
  try {
    const res = await fetch(url, options);
    const json = await res.json().catch(() => null);
    console.log(`[API ${name}] ${res.status}:`, JSON.stringify(json).slice(0, 150));
    return { status: res.status, ok: res.ok, data: json };
  } catch (err: any) {
    console.error(`[API ${name}] Error:`, err.message);
    return { status: 0, ok: false, error: err.message };
  }
}

async function main() {
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  console.log(`=== MissionPay Public Deploy Smoke Test ===`);
  console.log(`Target URL: ${BASE_URL}`);

  // 1. Health check
  await checkApi('health', `${BASE_URL}/api/health`);

  // 2. Judge receipts
  await checkApi('judge-receipts', `${BASE_URL}/api/judge/receipts`);

  // 3. Judge simulate (attacker address)
  await checkApi('judge-simulate', `${BASE_URL}/api/judge/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: '0x000000000000000000000000000000000000dEaD',
      amountAtomic: 10000,
    }),
  });

  // 4. Arena twin
  await checkApi('arena-twin', `${BASE_URL}/api/arena/twin`);

  // 5. Missions list
  await checkApi('missions', `${BASE_URL}/api/missions`);

  // 6. Policy (agent address null check)
  await checkApi('policy', `${BASE_URL}/api/policy`);

  // Browser tests and screenshots
  console.log('\n--- Capturing Screenshots ---');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  // Pin English language
  await page.addInitScript(() => localStorage.setItem('missionpay_lang', 'en'));

  // 1. Home /
  console.log('Visiting / ...');
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(OUT_DIR, 'home.png'), fullPage: false });
  console.log('Saved home.png');

  // 2. /judge
  console.log('Visiting /judge ...');
  await page.goto(`${BASE_URL}/judge`, { waitUntil: 'networkidle' });
  // Wait for twin receipts
  await page.waitForSelector('text=Twin #1: Global Allowlist Mode', { timeout: 15000 }).catch(() => {});
  await page.screenshot({ path: path.join(OUT_DIR, 'judge.png'), fullPage: false });
  console.log('Saved judge.png');

  // 3. /verify/fuji-live-mission-s1c
  console.log('Visiting /verify/fuji-live-mission-s1c ...');
  await page.goto(`${BASE_URL}/verify/fuji-live-mission-s1c`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=VALID', { timeout: 15000 }).catch(() => {});
  await page.screenshot({ path: path.join(OUT_DIR, 'verify-s1c.png'), fullPage: false });
  console.log('Saved verify-s1c.png');

  // 4. /bounty
  console.log('Visiting /bounty ...');
  await page.goto(`${BASE_URL}/bounty`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(OUT_DIR, 'bounty.png'), fullPage: false });
  console.log('Saved bounty.png');

  await browser.close();
  console.log('\n=== Smoke Test Complete ===');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
