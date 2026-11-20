import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('WOW-F16: Calibrate Bankr & Arena UI Claims (Anti-Hyperbole)', () => {
  const targetDirs = [
    path.resolve(process.cwd(), 'app/bankr'),
    path.resolve(process.cwd(), 'app/arena'),
    path.resolve(process.cwd(), 'app/stage'),
  ];

  function getFiles(dir: string): string[] {
    let results: string[] = [];
    if (!fs.existsSync(dir)) return results;
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat && stat.isDirectory()) {
        results = results.concat(getFiles(fullPath));
      } else if (fullPath.endsWith('.tsx') || fullPath.endsWith('.ts')) {
        results.push(fullPath);
      }
    }
    return results;
  }

  it('contains zero ungrounded "100%" claims across app/bankr, app/stage, and app/arena', () => {
    for (const dir of targetDirs) {
      const files = getFiles(dir);
      for (const file of files) {
        const content = fs.readFileSync(file, 'utf8');
        // Ignore files if any have LIVE_FUJI condition gating
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.includes('100%')) {
            throw new Error(`Found ungrounded '100%' claim in ${file}:${i + 1} -> ${line.trim()}`);
          }
        }
      }
    }
  });

  it('contains zero ungrounded "On-Chain" claims in MOCK sandbox panels', () => {
    for (const dir of targetDirs) {
      const files = getFiles(dir);
      for (const file of files) {
        const content = fs.readFileSync(file, 'utf8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // PV-F7: Stage can show "Payee root on-chain" conditionally when verified by receipt audit
          // app/arena/twin is not a MOCK panel: it renders real Fuji evidence and its live badge is
          // gated on mode === 'broadcast' + tx hashes (tests/twin-treasury.test.ts covers that gate).
          if (file.split('\\').join('/').includes('app/arena/twin/')) continue;
          if (/on-chain/i.test(line) && !line.includes('Payee root on-chain')) {
            // Must not have unverified claims
            throw new Error(`Found ungrounded 'On-Chain' in ${file}:${i + 1} -> ${line.trim()}`);
          }
        }
      }
    }
  });

  it('calibrated Bankr panel displays honest off-chain validator defense label', () => {
    const bankrPage = fs.readFileSync(path.resolve(process.cwd(), 'app/bankr/page.tsx'), 'utf8');
    expect(bankrPage).toContain('Tiền đã chuyển: $0.00 — chặn bởi validator (off-chain)');
    // The replay itself stays labelled off-chain; the contract layer points to the live Fuji proof.
    expect(bankrPage).toContain('Lớp contract: đã chứng minh trên Fuji');
    expect(bankrPage).toContain('(off-chain)');
    expect(bankrPage).toContain('HỆ THỐNG MISSIONPAY (MÔ PHỎNG SANDBOX)');
  });

  it('PV-F8: app/arena/stage/page.tsx contains no false smart contract claims in sandbox rules', () => {
    const arenaStagePage = fs.readFileSync(path.resolve(process.cwd(), 'app/arena/stage/page.tsx'), 'utf8');
    expect(arenaStagePage).not.toContain('Hợp đồng thông minh trên Avalanche sẽ tự động chặn mọi vi phạm');
    expect(arenaStagePage).toContain('Validator chặn người nhận không truy về chữ ký owner, lệnh vượt cap, và mọi lệnh đổi policy');
  });
});
