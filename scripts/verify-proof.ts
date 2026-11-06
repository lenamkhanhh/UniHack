import * as fs from 'fs';
import * as path from 'path';
import { keccak256, stringToBytes } from 'viem';
import {
  AuditEntry,
  Checkpoint,
  INITIAL_PREV_HASH,
  VerificationResult,
  parseProofData,
  verifyProof,
} from '../apps/web/lib/proof-verifier';

export type { AuditEntry, Checkpoint, VerificationResult };
export { INITIAL_PREV_HASH, parseProofData, verifyProof };

async function main() {
  const args = process.argv.slice(2);
  const filePath = args.find((a) => !a.startsWith('--'));

  if (!filePath) {
    console.log('Usage: npx tsx scripts/verify-proof.ts <path-to-proof.json> [--checkpoint <path>]');
    console.log('Running self-test verification with valid demo chain...');

    const dummyCanonicalJson =
      '{"actor":"0x1","amount":"0","chain_id":"43113","created_at":"2026-11-04T00:00:00.000Z","kind":"CUTOVER","mission_id":"m1","operation_id":"","policy_hash":"0x0","policy_version":"1","prev_hash":"0x0000000000000000000000000000000000000000000000000000000000000000","reason":"Genesis","result_hash":"","rule":"","source_key":"test:genesis","to":"","tx_hash":""}';
    const dummyEntry: AuditEntry = {
      sourceKey: 'test:genesis',
      prevHash: INITIAL_PREV_HASH,
      entryHash: keccak256(stringToBytes(dummyCanonicalJson)),
      canonicalJson: dummyCanonicalJson,
    };

    const res = verifyProof([dummyEntry], { entryCount: 1, headHash: dummyEntry.entryHash });
    if (res.valid) {
      console.log('PASS: Self-test verified successfully.');
      process.exit(0);
    } else {
      console.error('FAIL: Self-test failed:', res.errors);
      process.exit(1);
    }
  }

  let checkpointOverride: Checkpoint | null = null;
  const cpIdx = args.indexOf('--checkpoint');
  if (cpIdx !== -1 && args[cpIdx + 1]) {
    const cpRaw = fs.readFileSync(path.resolve(args[cpIdx + 1]), 'utf8');
    checkpointOverride = JSON.parse(cpRaw);
  }

  const raw = fs.readFileSync(path.resolve(filePath), 'utf8');
  const data = JSON.parse(raw);

  let parsedData: { entries: AuditEntry[]; checkpoint: Checkpoint | null };
  try {
    parsedData = parseProofData(data);
  } catch (err: any) {
    console.error(`FAIL: ${err.message}`);
    process.exit(1);
  }

  const checkpoint = checkpointOverride || parsedData.checkpoint;
  const res = verifyProof(parsedData.entries, checkpoint);

  if (res.valid) {
    console.log(`PASS: All ${res.totalEntries} entries verified. Head hash: ${res.headHash}`);
    process.exit(0);
  } else {
    console.error(`FAIL: Verification failed with ${res.errors.length} error(s):`);
    res.errors.forEach((err) => console.error(`  - ${err}`));
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Execution error:', err);
    process.exit(1);
  });
}
