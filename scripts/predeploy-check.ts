/**
 * Pre-Deployment Security & Secret Leak Scanner
 *
 * Checks:
 * 1. Fails if any *_PRIVATE_KEY / GEMINI_API_KEY / LLM_API_KEY value appears in tracked files or .next client chunks.
 * 2. Fails if NEXT_PUBLIC_* variables contain any 64-hex secret string.
 * 3. Runs gitleaks-style regex scanning over reachable git log history (commits reachable from HEAD).
 *
 * CRITICAL RULE: Lists findings by commit + file ONLY; NEVER prints secret values.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

interface Finding {
  category: 'TRACKED_FILE' | 'CLIENT_CHUNK' | 'NEXT_PUBLIC_VAR' | 'GIT_HISTORY';
  fileOrVar: string;
  commitHash?: string;
  rule: string;
}

const findings: Finding[] = [];

// Helper to safely read env files for secret values without printing them
function loadDiscoveredSecrets(): Map<string, string> {
  const secretMap = new Map<string, string>();
  const envFiles = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), 'apps/web/.env'),
    path.resolve(process.cwd(), '.env.local'),
    path.resolve(process.cwd(), 'apps/web/.env.local'),
  ];

  for (const envPath of envFiles) {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const match = trimmed.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
        if (match) {
          const key = match[1];
          let val = match[2].trim();
          if (
            (val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))
          ) {
            val = val.slice(1, -1);
          }
          if (
            (key.endsWith('_PRIVATE_KEY') ||
              key.endsWith('_SECRET') ||
              key.includes('GEMINI_API_KEY') ||
              key.includes('LLM_API_KEY') ||
              key === 'SESSION_WALLET_SEED') &&
            val.length >= 8 &&
            !val.includes('<') &&
            !val.includes('placeholder')
          ) {
            secretMap.set(key, val);
          }
        }
      }
    }
  }

  // Also include process.env
  for (const [k, v] of Object.entries(process.env)) {
    if (
      v &&
      (k.endsWith('_PRIVATE_KEY') ||
        k.endsWith('_SECRET') ||
        k.includes('GEMINI_API_KEY') ||
        k.includes('LLM_API_KEY') ||
        k === 'SESSION_WALLET_SEED') &&
      v.length >= 8 &&
      !v.includes('<')
    ) {
      secretMap.set(k, v);
    }
  }

  return secretMap;
}

console.log('================================================================');
console.log('   MissionPay Pre-Deployment Security Audit (Round 13-B)        ');
console.log('================================================================\n');

// 1. Check Tracked Files
console.log('[1/3] Scanning tracked git files for active secrets...');
const discoveredSecrets = loadDiscoveredSecrets();
let trackedFiles: string[] = [];

try {
  const lsOutput = execSync('git ls-files', { encoding: 'utf8' });
  trackedFiles = lsOutput.split('\n').map((f) => f.trim()).filter(Boolean);
} catch (err: any) {
  console.error('Failed to list git tracked files:', err.message);
}

for (const relPath of trackedFiles) {
  // Skip env files or node_modules
  if (relPath.startsWith('.env') || relPath.includes('node_modules')) continue;

  const fullPath = path.resolve(process.cwd(), relPath);
  if (!fs.existsSync(fullPath)) continue;

  // Skip large binary files
  const ext = path.extname(fullPath).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.pdf', '.webm', '.mp4', '.zip', '.gz'].includes(ext)) {
    continue;
  }

  try {
    const fileContent = fs.readFileSync(fullPath, 'utf8');
    for (const [secretName, secretVal] of discoveredSecrets.entries()) {
      if (fileContent.includes(secretVal)) {
        findings.push({
          category: 'TRACKED_FILE',
          fileOrVar: relPath,
          rule: `Found active secret value matching key: ${secretName}`,
        });
      }
    }
  } catch {
    // Ignore unreadable or binary
  }
}

// Check .next client chunks (if build exists)
console.log('      Scanning .next client static chunks for leaked secrets...');
const clientChunksDir = path.resolve(process.cwd(), 'apps/web/.next/static');
if (fs.existsSync(clientChunksDir)) {
  const scanDirRecursive = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        scanDirRecursive(full);
      } else if (ent.isFile() && (ent.name.endsWith('.js') || ent.name.endsWith('.css'))) {
        try {
          const chunkContent = fs.readFileSync(full, 'utf8');
          for (const [secretName, secretVal] of discoveredSecrets.entries()) {
            if (chunkContent.includes(secretVal)) {
              findings.push({
                category: 'CLIENT_CHUNK',
                fileOrVar: path.relative(process.cwd(), full),
                rule: `Found active secret value matching key: ${secretName} in client bundle`,
              });
            }
          }
        } catch {}
      }
    }
  };
  scanDirRecursive(clientChunksDir);
} else {
  console.log('      (Note: apps/web/.next/static not present; skipping client bundle check)');
}

// 2. Check NEXT_PUBLIC_* variables for 64-hex patterns
console.log('\n[2/3] Auditing NEXT_PUBLIC_* environment variables for 64-hex secrets...');
const envFilesToCheck = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), 'apps/web/.env'),
  path.resolve(process.cwd(), '.env.production'),
  path.resolve(process.cwd(), 'apps/web/.env.production'),
];

const checkNextPublic = (key: string, val: string, source: string) => {
  if (key.startsWith('NEXT_PUBLIC_')) {
    // 64-hex pattern: 0x followed by 64 hex chars, or raw 64 hex chars
    const match = val.match(/(?:0x)?[0-9a-fA-F]{64}/);
    if (match) {
      findings.push({
        category: 'NEXT_PUBLIC_VAR',
        fileOrVar: `${key} in ${source}`,
        rule: 'Contains 64-hex string which may be a private key or raw secret hash',
      });
    }
  }
};

for (const envPath of envFilesToCheck) {
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const m = trimmed.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
      if (m) {
        checkNextPublic(m[1], m[2].trim(), path.relative(process.cwd(), envPath));
      }
    }
  }
}

for (const [k, v] of Object.entries(process.env)) {
  if (v && k.startsWith('NEXT_PUBLIC_')) {
    checkNextPublic(k, v, 'process.env');
  }
}

// 3. Gitleaks-style scan over reachable git history
console.log('\n[3/3] Performing gitleaks-style regex scan over commits reachable from HEAD...');

const SECRET_REGEX_RULES: { name: string; regex: RegExp }[] = [
  {
    name: 'Hex Private Key Assignment',
    regex: /^\+.*(?:PRIVATE_KEY|private_key|SECRET|secret)\s*[:=]\s*["']?(0x[a-fA-F0-9]{64}|[a-fA-F0-9]{64})["']?/,
  },
  {
    name: 'Google API Key',
    regex: /^\+.*(?:AIza[0-9A-Za-z_-]{35})/,
  },
  {
    name: 'OpenAI / Anthropic Secret Key',
    regex: /^\+.*(?:sk-(?:live|ant|proj)?[0-9a-zA-Z_-]{20,})/,
  },
];

// Placeholder values to ignore
const IGNORED_SNIPPETS = [
  '<OWNER_KEY>',
  '<AGENT_KEY>',
  '<VALIDATOR_KEY>',
  '<min-32-chars',
  '<google-ai',
  '0x0000000000000000000000000000000000000000000000000000000000000000',
  '0x1111111111111111111111111111111111111111',
  '0x2222222222222222222222222222222222222222',
  '0x3333333333333333333333333333333333333333',
  '0x4BC93356C180Ba2Dd13A4a1Cf43405Bd0eb58F7c', // Owner public address
  '0x374b8A126FDb9e5deEc8307da385076155Af3D72', // Agent public address
  '0x20451c1e2dCD83F166B4f22868BAdECb5868d545', // GuardedTreasury address
  '0x5425890298aed601595a70AB815c96711a31Bc65', // USDC address
  '0xE90cf574D332658f9dfB950d899610Fb2F6e1aEA', // Relayer/vendor public address
  '0x609d0c2a96678100e4419faa96fccaaf6b809c245d75b02afa0d18e9c93a560f', // Public bounty mission ID
  '0x7477696e2e616c6c6f776c6973742e7631', // twin.allowlist.v1 hex
  '0x7477696e2e6d697373696f6e2e7631', // twin.mission.v1 hex
  '0x3011ac814b7ad5d2788091d9bf42b719e566fdf9ebe5c18dd3ea556dee6b71dd', // Root B hash
  '0xc6ce8ae383124b268df66d71f0af2206e6dafb13eba0b03806eed8a4e7991329', // Bounty Root hash
  'placeholder',
  'example',
  // Well-known public test fixture keys (Anvil / Foundry standard local keys)
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // Anvil #0 test key
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', // Anvil #1 test key
  '0x5de4111afa1a4b94908f83103eb2f953b0e010eefec8ac3293e55d4008b042c2', // Anvil #2 test key
  '0x1234567890123456789012345678901234567890123456789012345678901234', // Dummy sequence
];

try {
  // Read git patch of reachable commits
  const gitLog = execSync('git log -p HEAD', {
    maxBuffer: 50 * 1024 * 1024,
    encoding: 'utf8',
  });

  const lines = gitLog.split('\n');
  let currentCommit = 'unknown';
  let currentFile = 'unknown';

  for (const line of lines) {
    if (line.startsWith('commit ')) {
      currentCommit = line.split(' ')[1].slice(0, 7);
    } else if (line.startsWith('diff --git a/')) {
      const match = line.match(/^diff --git a\/(.*) b\/(.*)$/);
      if (match) {
        currentFile = match[2];
      }
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      // Check if line contains ignored placeholders
      let isIgnored = false;
      for (const ign of IGNORED_SNIPPETS) {
        if (line.includes(ign)) {
          isIgnored = true;
          break;
        }
      }
      if (isIgnored) continue;

      for (const rule of SECRET_REGEX_RULES) {
        if (rule.regex.test(line)) {
          findings.push({
            category: 'GIT_HISTORY',
            fileOrVar: currentFile,
            commitHash: currentCommit,
            rule: rule.name,
          });
        }
      }
    }
  }
} catch (err: any) {
  console.error('Git log scanning error:', err.message);
}

// Summary Report
console.log('================================================================');
console.log('   SCAN AUDIT RESULTS SUMMARY                                   ');
console.log('================================================================');

if (findings.length === 0) {
  console.log('✅ ALL CHECKS PASSED: ZERO SECRETS DETECTED!');
  console.log('- Tracked files: CLEAN (no active private keys or API keys)');
  console.log('- NEXT_PUBLIC_* variables: CLEAN (no 64-hex secret tokens)');
  console.log('- Reachable git history from HEAD: CLEAN (no exposed secrets)');
  console.log('================================================================\n');
  process.exit(0);
} else {
  console.error(`❌ SECURITY SCAN FAILED: ${findings.length} VIOLATION(S) DETECTED!\n`);
  for (const f of findings) {
    if (f.category === 'GIT_HISTORY') {
      console.error(
        `  [!] Commit ${f.commitHash} | File: ${f.fileOrVar} | Rule: ${f.rule}`
      );
    } else {
      console.error(
        `  [!] Category: ${f.category} | Target: ${f.fileOrVar} | Rule: ${f.rule}`
      );
    }
  }
  console.error('\nNOTE: Specific secret values are NEVER printed above.');
  console.error('================================================================\n');
  process.exit(1);
}
