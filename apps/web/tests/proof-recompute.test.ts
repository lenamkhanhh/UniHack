import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { verifyProof, recomputeChainHead, type AuditEntry } from '../lib/proof-verifier';

// Real audit export of the anchored Fuji mission shown on /verify/fuji-live-mission-s1c.
const audit = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '../../../evidence/missions/fuji-live-mission-s1c/audit.json'),
    'utf8'
  )
);
const ANCHORED_HEAD = '0xb6383cfec46d06ac2f6ba3c83b122baa48cf9bcd8b748cc4e2c6c7ad40814158';

const entries: AuditEntry[] = audit.entries.map((e: any) => ({
  sourceKey: e.sourceKey ?? e.source_key,
  prevHash: e.prevHash ?? e.prev_hash,
  entryHash: e.entryHash ?? e.entry_hash,
  canonicalJson: e.canonicalJson ?? e.canonical_json,
}));

describe('recomputed chain head (verify page tamper demo)', () => {
  it('equals the anchored head for the intact s1c chain', () => {
    const r = verifyProof(entries);
    expect(r.valid).toBe(true);
    expect(r.recomputedHeadHash.toLowerCase()).toBe(ANCHORED_HEAD);
    expect(r.recomputedHeadHash).toBe(r.headHash);
  });

  it('changes the head when one byte of a middle entry changes', () => {
    const tampered = entries.map((e) => ({ ...e }));
    tampered[1] = { ...tampered[1], canonicalJson: tampered[1].canonicalJson.replace('"amount":"0"', '"amount":"1"') };
    expect(tampered[1].canonicalJson).not.toBe(entries[1].canonicalJson);
    const r = verifyProof(tampered);
    expect(r.valid).toBe(false);
    expect(recomputeChainHead(tampered).toLowerCase()).not.toBe(ANCHORED_HEAD);
    // The declared head alone would not reveal the edit.
    expect(r.headHash.toLowerCase()).toBe(ANCHORED_HEAD);
  });
});
