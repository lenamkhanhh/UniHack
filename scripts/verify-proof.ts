import * as fs from 'fs';
import * as path from 'path';
import { keccak256, stringToBytes } from 'viem';

export interface AuditEntry {
  sourceKey: string;
  prevHash: string;
  entryHash: string;
  canonicalJson: string;
}

export interface Checkpoint {
  headHash: string;
  entryCount: number;
}

export const INITIAL_PREV_HASH =
  '0x0000000000000000000000000000000000000000000000000000000000000000';

export function verifyProof(
  entries: AuditEntry[],
  checkpoint?: Checkpoint | null,
  expectedResult?: string | { operationId?: string; resultHash?: string; result?: string }
) {
  const errors: string[] = [];
  const seenSourceKeys = new Set<string>();
  let currentPrevHash = INITIAL_PREV_HASH;

  if (!Array.isArray(entries)) {
    return {
      valid: false,
      errors: ['Entries must be an array'],
      headHash: INITIAL_PREV_HASH,
      totalEntries: 0,
    };
  }

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    if (!entry.sourceKey || !entry.entryHash || !entry.canonicalJson || !entry.prevHash) {
      errors.push(`Entry ${i} is missing required fields`);
      continue;
    }

    if (seenSourceKeys.has(entry.sourceKey)) {
      errors.push(`Duplicate sourceKey at entry ${i}: ${entry.sourceKey}`);
    }
    seenSourceKeys.add(entry.sourceKey);

    if (entry.prevHash.toLowerCase() !== currentPrevHash.toLowerCase()) {
      errors.push(
        `Chain broken at index ${i}: declared prevHash ${entry.prevHash} != expected ${currentPrevHash}`
      );
    }

    const computed = keccak256(stringToBytes(entry.canonicalJson));
    if (computed.toLowerCase() !== entry.entryHash.toLowerCase()) {
      errors.push(
        `Hash mismatch at index ${i}: computed ${computed} != declared ${entry.entryHash}`
      );
    }

    // Parse canonical JSON and enforce inner/outer equality (Finding F11)
    let parsed: any;
    try {
      parsed = JSON.parse(entry.canonicalJson);
    } catch (parseErr: any) {
      errors.push(`Invalid JSON at index ${i}: ${parseErr.message}`);
      continue;
    }

    if (parsed.source_key !== entry.sourceKey) {
      errors.push(
        `Inner/outer sourceKey mismatch at index ${i}: inner '${parsed.source_key}' != outer '${entry.sourceKey}'`
      );
    }

    if ((parsed.prev_hash || '').toLowerCase() !== entry.prevHash.toLowerCase()) {
      errors.push(
        `Inner/outer prevHash mismatch at index ${i}: inner '${parsed.prev_hash}' != outer '${entry.prevHash}'`
      );
    }

    currentPrevHash = entry.entryHash;
  }

  if (checkpoint) {
    if (checkpoint.entryCount !== entries.length) {
      errors.push(
        `Entry count mismatch: checkpoint ${checkpoint.entryCount} != actual ${entries.length}`
      );
    }
    if (checkpoint.headHash.toLowerCase() !== currentPrevHash.toLowerCase()) {
      errors.push(
        `Head hash mismatch: checkpoint ${checkpoint.headHash} != computed ${currentPrevHash}`
      );
    }
  }

  if (expectedResult) {
    const opId = typeof expectedResult === 'object' ? expectedResult.operationId : undefined;
    const resHash =
      typeof expectedResult === 'object'
        ? expectedResult.resultHash || (expectedResult.result ? keccak256(stringToBytes(expectedResult.result)) : undefined)
        : keccak256(stringToBytes(expectedResult));

    let matched = false;
    for (let i = entries.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(entries[i].canonicalJson);
        if ((!opId || parsed.operation_id === opId) && parsed.result_hash) {
          matched = true;
          if (resHash && parsed.result_hash.toLowerCase() !== resHash.toLowerCase()) {
            errors.push(
              `Result hash mismatch: expected ${resHash} != entry result_hash ${parsed.result_hash}`
            );
          }
          break;
        }
      } catch {}
    }
    if (!matched && resHash) {
      errors.push('No matching operation found with result_hash');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    headHash: currentPrevHash,
    totalEntries: entries.length,
  };
}

export function parseProofData(data: any): { entries: AuditEntry[]; checkpoint: Checkpoint | null } {
  if (Array.isArray(data)) {
    return { entries: data, checkpoint: null };
  }

  if (data && typeof data === 'object') {
    if (data.audit && Array.isArray(data.audit.entries)) {
      return {
        entries: data.audit.entries,
        checkpoint: data.audit.checkpoint || null,
      };
    }
    if (Array.isArray(data.entries)) {
      return {
        entries: data.entries,
        checkpoint: data.checkpoint || null,
      };
    }
  }

  throw new Error(
    'Invalid proof format: neither "audit.entries" nor top-level "entries" array was found in proof file'
  );
}

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
