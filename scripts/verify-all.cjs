#!/usr/bin/env node
/**
 * One-Command Full Suite Verification (P0-2)
 * Runs contracts, guard SDK, web typecheck, web vitest, and agentdojo benchmark tests.
 */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const rootDir = path.resolve(__dirname, '..');
const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';
const npxCmd = isWin ? 'npx.cmd' : 'npx';

const pythonBin = fs.existsSync(path.join(rootDir, 'eval', 'agentdojo', '.venv', 'Scripts', 'python.exe'))
  ? path.join(rootDir, 'eval', 'agentdojo', '.venv', 'Scripts', 'python.exe')
  : fs.existsSync(path.join(rootDir, 'eval', 'agentdojo', '.venv', 'bin', 'python'))
  ? path.join(rootDir, 'eval', 'agentdojo', '.venv', 'bin', 'python')
  : 'python';

const suites = [
  {
    name: '1. Foundry Smart Contracts (forge test --summary)',
    cmd: 'forge',
    args: ['test', '--summary'],
    cwd: path.join(rootDir, 'contracts'),
  },
  {
    name: '2. Guard SDK Tests (@missionpay/guard)',
    cmd: npmCmd,
    args: ['--workspace=@missionpay/guard', 'run', 'test'],
    cwd: rootDir,
  },
  {
    name: '3. Generate Prisma Client (prisma generate)',
    cmd: npmCmd,
    args: ['--workspace=apps/web', 'run', 'prisma:generate'],
    cwd: rootDir,
  },
  {
    name: '4. Web TypeScript Typecheck (tsc --noEmit)',
    cmd: npxCmd,
    args: ['tsc', '--noEmit', '-p', 'apps/web/tsconfig.json'],
    cwd: rootDir,
  },
  {
    name: '5. Web Vitest Suite (apps/web)',
    cmd: npmCmd,
    args: ['--workspace=apps/web', 'run', 'test'],
    cwd: rootDir,
  },
  {
    name: '6. AgentDojo ProvGuard Pair Suite',
    cmd: pythonBin,
    args: [path.join(rootDir, 'eval', 'agentdojo', 'test_provguard_pairs.py')],
    cwd: rootDir,
  },
];

console.log('='.repeat(70));
console.log('   MissionPay: Full Verification Suite (npm run verify:all)');
console.log('='.repeat(70));

let allPassed = true;
const results = [];

for (const suite of suites) {
  console.log(`\n>>> [RUNNING] ${suite.name}...`);
  const start = Date.now();
  const res = spawnSync(suite.cmd, suite.args, {
    cwd: suite.cwd,
    stdio: 'inherit',
    shell: isWin,
    env: { ...process.env, PAYMENT_MODE: process.env.PAYMENT_MODE || 'MOCK' },
  });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const passed = res.status === 0;
  if (!passed) allPassed = false;
  results.push({ name: suite.name, passed, elapsed });
  console.log(`<<< [${passed ? 'PASSED' : 'FAILED'}] ${suite.name} (${elapsed}s)`);
}

console.log('\n' + '='.repeat(70));
console.log('   Verification Summary');
console.log('='.repeat(70));
for (const r of results) {
  const icon = r.passed ? '✓ PASS' : '✗ FAIL';
  console.log(`  ${icon.padEnd(8)} | ${r.name.padEnd(52)} (${r.elapsed}s)`);
}
console.log('='.repeat(70));

if (allPassed) {
  console.log('\n🎉 ALL SUITES PASSED! Verification successful.\n');
  process.exit(0);
} else {
  console.error('\n❌ ONE OR MORE SUITES FAILED.\n');
  process.exit(1);
}
