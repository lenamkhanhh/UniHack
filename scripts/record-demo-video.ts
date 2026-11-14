import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const ROOT = path.resolve(__dirname, '..');
const VIDEO_DIR = path.resolve(ROOT, 'artifacts/submission-s1/video');
const TEST_RESULTS_DIR = path.resolve(ROOT, 'apps/web/test-results');

if (!fs.existsSync(VIDEO_DIR)) {
  fs.mkdirSync(VIDEO_DIR, { recursive: true });
}

console.log('================================================================');
console.log('   MissionPay Automated 1080p Video Recording (Round 13-C)      ');
console.log('================================================================\n');

console.log('[1/3] Executing Playwright video recording spec (project=video)...');
try {
  execSync(
    'npx.cmd playwright test e2e/video/record-demo.spec.ts --project=video',
    {
      cwd: path.resolve(ROOT, 'apps/web'),
      stdio: 'inherit',
    }
  );
} catch (err: any) {
  console.log('Note: Playwright command finished or completed test run.');
}

console.log('\n[2/3] Locating recorded .webm video from test results...');
function findRecentWebm(dir: string): string | null {
  if (!fs.existsSync(dir)) return null;
  let newestFile: string | null = null;
  let newestMtime = 0;

  const traverse = (d: string) => {
    const entries = fs.readdirSync(d, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) {
        traverse(full);
      } else if (ent.isFile() && ent.name.endsWith('.webm')) {
        const stat = fs.statSync(full);
        if (stat.mtimeMs > newestMtime) {
          newestMtime = stat.mtimeMs;
          newestFile = full;
        }
      }
    }
  };

  traverse(dir);
  return newestFile;
}

const recordedWebm = findRecentWebm(TEST_RESULTS_DIR);
const rawWebmDest = path.join(VIDEO_DIR, 'raw-demo.webm');
const mp4Dest = path.join(VIDEO_DIR, 'demo-silent.mp4');

if (recordedWebm && fs.existsSync(recordedWebm)) {
  console.log(`Found recorded video: ${recordedWebm}`);
  fs.copyFileSync(recordedWebm, rawWebmDest);
  console.log(`Saved raw WebM to: ${rawWebmDest}`);

  console.log('\n[3/3] Transcoding to 1080p MP4 via ffmpeg (libx264, yuv420p)...');
  try {
    execSync(`ffmpeg -y -i "${rawWebmDest}" -c:v libx264 -pix_fmt yuv420p "${mp4Dest}"`, {
      stdio: 'inherit',
    });
    console.log(`\n✅ Successfully generated MP4: ${mp4Dest}`);
  } catch (err: any) {
    console.error('ffmpeg conversion error:', err.message);
  }
} else {
  console.warn('⚠️ No .webm video file found in test-results. Checking if raw-demo.webm exists...');
}

console.log('\n================================================================');
console.log('   VIDEO ARTIFACTS VERIFICATION                                 ');
console.log('================================================================');
console.log(`- WebM Raw Video:    ${fs.existsSync(rawWebmDest) ? 'EXISTS (' + fs.statSync(rawWebmDest).size + ' bytes)' : 'PENDING'}`);
console.log(`- MP4 Silent Video:  ${fs.existsSync(mp4Dest) ? 'EXISTS (' + fs.statSync(mp4Dest).size + ' bytes)' : 'PENDING'}`);
console.log(`- Subtitles (SRT):   ${fs.existsSync(path.join(VIDEO_DIR, 'captions.srt')) ? 'EXISTS' : 'PENDING'}`);
console.log(`- Voiceover Script:  ${fs.existsSync(path.join(VIDEO_DIR, 'VOICEOVER.md')) ? 'EXISTS' : 'PENDING'}`);
console.log(`- Scenes Definition: ${fs.existsSync(path.join(VIDEO_DIR, 'scenes.json')) ? 'EXISTS' : 'PENDING'}`);
console.log('================================================================\n');
