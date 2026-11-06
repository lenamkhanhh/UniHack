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
  timestamp?: string | Date;
}

export const INITIAL_PREV_HASH =
  '0x0000000000000000000000000000000000000000000000000000000000000000';

export interface VerificationResult {
  valid: boolean;
  errors: string[];
  headHash: string;
  totalEntries: number;
}

/**
 * Pure cryptographic proof verifier for use in browser client & server.
 * Verifies sequential hash-chain continuity:
 * entry.prevHash === previous entry.entryHash
 * entry.entryHash === keccak256(canonicalJson)
 * checkpoint.headHash === final entryHash
 * checkpoint.entryCount === entries.length
 */
export function verifyProof(
  entries: AuditEntry[],
  checkpoint?: Checkpoint | null,
  expectedResult?: string | { operationId?: string; resultHash?: string; result?: string }
): VerificationResult {
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

    // Parse canonical JSON and enforce inner/outer equality
    let parsed: any;
    try {
      parsed = JSON.parse(entry.canonicalJson);
    } catch (parseErr: any) {
      errors.push(`Invalid JSON at index ${i}: ${parseErr.message}`);
      continue;
    }

    if (parsed.source_key && parsed.source_key !== entry.sourceKey) {
      errors.push(
        `Inner/outer sourceKey mismatch at index ${i}: inner '${parsed.source_key}' != outer '${entry.sourceKey}'`
      );
    }

    if (parsed.prev_hash && parsed.prev_hash.toLowerCase() !== entry.prevHash.toLowerCase()) {
      errors.push(
        `Inner/outer prevHash mismatch at index ${i}: inner '${parsed.prev_hash}' != outer '${entry.prevHash}'`
      );
    }

    currentPrevHash = entry.entryHash;
  }

  if (checkpoint) {
    if (checkpoint.entryCount !== entries.length) {
      errors.push(
        `Entry count mismatch: checkpoint count ${checkpoint.entryCount} != actual ${entries.length}`
      );
    }
    if (checkpoint.headHash.toLowerCase() !== currentPrevHash.toLowerCase()) {
      errors.push(
        `Head hash mismatch: checkpoint ${checkpoint.headHash} != computed ${currentPrevHash}`
      );
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
    'Invalid proof format: neither "audit.entries" nor top-level "entries" array was found in proof payload'
  );
}
