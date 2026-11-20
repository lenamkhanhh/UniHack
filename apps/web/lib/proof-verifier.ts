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
  /**
   * Head obtained by recomputing every link from the content itself: each entry is
   * re-hashed with its prev_hash replaced by the previous recomputed hash. Equals
   * headHash for an intact chain; differs as soon as any byte of any entry changes.
   */
  recomputedHeadHash: string;
  totalEntries: number;
}

/** Re-hash the chain from content, propagating each recomputed hash into the next entry. */
export function recomputeChainHead(entries: AuditEntry[]): string {
  let prev = INITIAL_PREV_HASH;
  for (const entry of entries) {
    let json = entry.canonicalJson || '';
    const declaredPrev = entry.prevHash || '';
    if (declaredPrev && declaredPrev.toLowerCase() !== prev.toLowerCase()) {
      json = json.split(`"prev_hash":"${declaredPrev}"`).join(`"prev_hash":"${prev}"`);
    }
    prev = keccak256(stringToBytes(json));
  }
  return prev;
}

/**
 * Unified cryptographic proof verifier for browser client, server, and CLI.
 * Strict rules:
 * - sequential hash-chain continuity: entry.prevHash === previous entry.entryHash
 * - entry.entryHash === keccak256(canonicalJson)
 * - inner canonicalJson parsed.source_key === entry.sourceKey
 * - inner canonicalJson parsed.prev_hash === entry.prevHash (strictly required, missing -> FAIL)
 * - checkpoint.headHash === final entryHash
 * - checkpoint.entryCount === entries.length
 * - expectedResult matching when provided
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
      recomputedHeadHash: INITIAL_PREV_HASH,
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

    // Parse canonical JSON and enforce inner/outer equality strictly (Finding F11 / VER-02)
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
        `Entry count mismatch: checkpoint count ${checkpoint.entryCount} != actual ${entries.length}`
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
    recomputedHeadHash: recomputeChainHead(entries),
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
