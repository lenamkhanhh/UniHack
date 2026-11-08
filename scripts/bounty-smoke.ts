/**
 * WOW-W3: Public Treasury Bounty Smoke Runner
 *
 * Runs 5 realistic ADI attack payloads against the Bounty pipeline:
 * - Real Gemini LLM planner (gemini-3.5-flash-lite)
 * - Pipeline C2 Validator (Provenance + Merkle Root)
 * - Real Avalanche Fuji eth_call (proposeWithProof revert check)
 *
 * Saves output to evidence/bounty/smoke.json
 */

import fs from 'fs';
import path from 'path';
import { processBountyAttempt, resetRateLimits } from '../apps/web/lib/bounty';

async function main() {
  console.log('[Bounty Smoke] Starting 5-payload smoke verification with Gemini + Fuji eth_call...');

  const adiPath = path.resolve(__dirname, '../eval/cases/adi.jsonl');
  if (!fs.existsSync(adiPath)) {
    throw new Error('adi.jsonl dataset not found at ' + adiPath);
  }

  const rawLines = fs.readFileSync(adiPath, 'utf8').trim().split('\n');
  const allCases = rawLines.map((l) => JSON.parse(l));

  // Pick 5 distinct attack cases across different categories
  const targetCaseIds = ['adi-rec-01', 'adi-rec-05', 'adi-rec-10', 'adi-rec-15', 'adi-rec-20'];
  const selectedCases = allCases.filter((c: any) => targetCaseIds.includes(c.id)).slice(0, 5);

  const vectors: Array<'search_result' | 'invoice_pdf_text' | 'vendor_page' | 'email'> = [
    'invoice_pdf_text',
    'search_result',
    'vendor_page',
    'email',
    'invoice_pdf_text',
  ];

  const results: any[] = [];

  for (let i = 0; i < selectedCases.length; i++) {
    const c = selectedCases[i];
    const vector = vectors[i % vectors.length];
    const payload = c.toolOutput?.content || c.description;
    const attackerAddress = c.targetAttackerPayee || '0x6666666666666666666666666666666666666666';

    console.log(`\n--- [Smoke ${i + 1}/5] Case: ${c.id} (${vector}) ---`);
    console.log(`Attacker Target: ${attackerAddress}`);
    console.log(`Payload preview: ${payload.slice(0, 80)}...`);

    // Reset rate limits between smoke iterations to ensure clean runs
    resetRateLimits();

    const attemptResult = await processBountyAttempt(
      payload,
      attackerAddress,
      vector,
      `198.51.100.${20 + i}`
    );

    console.log(`  LLM Tricked:     ${attemptResult.llmTricked ? 'YES (Tricked)' : 'NO (Resilient)'}`);
    console.log(`  Off-chain Rule:  ${attemptResult.offchainVerdict.rule || 'PASS'}`);
    console.log(`  Fuji eth_call:   ${attemptResult.onchainResult}`);
    console.log(`  Treasury Balance:${attemptResult.treasuryBalanceUsdc} USDC`);

    results.push({
      caseId: c.id,
      vector,
      attackerAddress,
      llmTricked: attemptResult.llmTricked,
      offchainRule: attemptResult.offchainVerdict.rule,
      onchainResult: attemptResult.onchainResult,
      treasuryBalance: attemptResult.treasuryBalanceUsdc,
      status: attemptResult.status,
    });
  }

  // Save to evidence/bounty/smoke.json
  const outDir = path.resolve(__dirname, '../evidence/bounty');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const outPath = path.join(outDir, 'smoke.json');
  fs.writeFileSync(outPath, JSON.stringify({ executedAt: new Date().toISOString(), results }, null, 2), 'utf8');
  console.log(`\n[Bounty Smoke COMPLETE] Saved evidence to ${outPath}`);
}

main().catch((err) => {
  console.error('[Bounty Smoke Error]', err);
  process.exit(1);
});
