const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PAGES = [
  { name: 'landing', path: '/' },
  { name: 'bounty', path: '/bounty' },
  { name: 'verify', path: '/verify/demo-seed' },
  { name: 'missions-new', path: '/missions/new' },
  { name: 'arena-stage', path: '/arena/stage' },
];

const BASE_URL = process.env.BASE_URL || 'http://localhost:3100';
const OUT_DIR = path.resolve(__dirname, '../evidence/ux');

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

console.log(`Running Lighthouse audit against ${BASE_URL} for ${PAGES.length} pages...`);

const results = {};

for (const p of PAGES) {
  const url = `${BASE_URL}${p.path}`;
  const outPath = path.join(OUT_DIR, `lighthouse-${p.name}.json`);
  console.log(`\nAuditing [${p.name}] ${url}...`);

  try {
    const cmd = `npx.cmd lighthouse "${url}" --chrome-flags="--headless --no-sandbox" --output=json --output-path="${outPath}" --only-categories=accessibility,performance,best-practices --quiet`;
    execSync(cmd, { stdio: 'inherit' });

    const raw = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    const scores = {
      accessibility: Math.round((raw.categories?.accessibility?.score || 0) * 100),
      performance: Math.round((raw.categories?.performance?.score || 0) * 100),
      bestPractices: Math.round((raw.categories?.['best-practices']?.score || 0) * 100),
    };
    results[p.name] = scores;
    console.log(`[${p.name}] A11y: ${scores.accessibility} | Perf: ${scores.performance} | BestPractices: ${scores.bestPractices}`);
  } catch (err) {
    console.error(`Error auditing ${p.name}:`, err.message);
    results[p.name] = { error: err.message };
  }
}

console.log('\n=== LIGHTHOUSE SUMMARY ===');
console.table(results);

fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(results, null, 2));
