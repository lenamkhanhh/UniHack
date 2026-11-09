const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

async function captureMobileUX() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });

  const page = await context.newPage();
  const outDir = path.resolve(__dirname, '../evidence/ux');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const targets = [
    { url: 'http://localhost:3100/bounty', filename: 'mobile-bounty-375.png' },
    { url: 'http://localhost:3100/verify/demo-seed', filename: 'mobile-verify-375.png' },
  ];

  for (const t of targets) {
    console.log(`Navigating to ${t.url} at 375px...`);
    await page.goto(t.url, { waitUntil: 'networkidle', timeout: 30000 });
    
    // Check horizontal overflow
    const overflow = await page.evaluate(() => {
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        hasHorizontalScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      };
    });

    console.log(`[${t.filename}] scrollWidth: ${overflow.scrollWidth}, clientWidth: ${overflow.clientWidth}, hasHorizontalScroll: ${overflow.hasHorizontalScroll}`);

    const dest = path.join(outDir, t.filename);
    await page.screenshot({ path: dest, fullPage: true });
    console.log(`Saved screenshot to ${dest}`);
  }

  await browser.close();
  console.log('Mobile UX capture complete!');
}

captureMobileUX().catch((err) => {
  console.error('Error capturing mobile UX:', err);
  process.exit(1);
});
