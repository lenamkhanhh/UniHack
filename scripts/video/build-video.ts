import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { chromium } from 'playwright';

const ROOT = path.resolve(__dirname, '../..');
const VIDEO_DIR = path.resolve(ROOT, 'artifacts/submission-s1/video');
const CARDS_DIR = path.resolve(VIDEO_DIR, 'cards');
const FINAL_OUTPUT = path.join(VIDEO_DIR, 'MissionPay-demo.mp4');

// Parse CLI flags
const args = process.argv.slice(2);
let customVoicePath: string | null = null;
let skipRecord = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--voice' && args[i + 1]) {
    customVoicePath = path.resolve(args[i + 1]);
    i++;
  } else if (args[i] === '--skip-record') {
    skipRecord = true;
  }
}

async function renderCardScreenshots() {
  console.log('[1/5] Rendering Title and Illustration cards with Playwright (1920x1080)...');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  // 1. Intro Card
  const introPath = path.join(CARDS_DIR, 'intro.html');
  await page.goto(`file://${introPath}`);
  await page.waitForTimeout(1000);
  const introPng = path.join(CARDS_DIR, 'intro.png');
  await page.screenshot({ path: introPng });
  console.log('  - Rendered intro.png');

  // 2. Diagram Card
  const diagramPath = path.join(CARDS_DIR, 'diagram.html');
  await page.goto(`file://${diagramPath}`);
  await page.waitForTimeout(1500);
  const diagramPng = path.join(CARDS_DIR, 'diagram.png');
  await page.screenshot({ path: diagramPng });
  console.log('  - Rendered diagram.png');

  // 3. Outro Card
  const outroPath = path.join(CARDS_DIR, 'outro.html');
  await page.goto(`file://${outroPath}`);
  await page.waitForTimeout(1000);
  const outroPng = path.join(CARDS_DIR, 'outro.png');
  await page.screenshot({ path: outroPng });
  console.log('  - Rendered outro.png');

  await browser.close();

  // Convert static cards to MP4 clips via ffmpeg
  console.log('Converting card images to 1080p30 video clips...');
  const introMp4 = path.join(CARDS_DIR, 'card_intro.mp4');
  const diagramMp4 = path.join(CARDS_DIR, 'card_diagram.mp4');
  const outroMp4 = path.join(CARDS_DIR, 'card_outro.mp4');

  // Intro: 3.5s
  execSync(
    `ffmpeg -y -loop 1 -i "${introPng}" -c:v libx264 -t 3.5 -pix_fmt yuv420p -r 30 "${introMp4}"`,
    { stdio: 'pipe' }
  );
  // Diagram: 6.0s
  execSync(
    `ffmpeg -y -loop 1 -i "${diagramPng}" -c:v libx264 -t 6.0 -pix_fmt yuv420p -r 30 "${diagramMp4}"`,
    { stdio: 'pipe' }
  );
  // Outro: 6.5s
  execSync(
    `ffmpeg -y -loop 1 -i "${outroPng}" -c:v libx264 -t 6.5 -pix_fmt yuv420p -r 30 "${outroMp4}"`,
    { stdio: 'pipe' }
  );

  return { introMp4, diagramMp4, outroMp4 };
}

function getDuration(filePath: string): number {
  const out = execSync(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
  )
    .toString()
    .trim();
  return parseFloat(out);
}

async function main() {
  console.log('================================================================');
  console.log('   MissionPay Post-Production Video Pipeline (Round 13-D)       ');
  console.log('================================================================\n');

  // Step 1: Render Cards
  const cards = await renderCardScreenshots();

  // Step 2: Ensure voiceover audio exists
  let audioPath = customVoicePath;
  if (!audioPath) {
    audioPath = path.join(VIDEO_DIR, 'voiceover-draft.mp3');
    if (!fs.existsSync(audioPath)) {
      console.log('[2/5] Voiceover draft missing, generating via edge-tts...');
      const { generateMasterVoiceover } = require('./generate-voiceover');
      await generateMasterVoiceover(audioPath);
    } else {
      console.log(`[2/5] Using existing voiceover draft: ${audioPath}`);
    }
  } else {
    console.log(`[2/5] Using Track B (Owner Voice): ${audioPath}`);
  }

  // Step 3: Check demo recording
  const demoSilentMp4 = path.join(VIDEO_DIR, 'demo-silent.mp4');
  if (!fs.existsSync(demoSilentMp4)) {
    console.log('[3/5] Demo silent recording missing. Please run scripts/record-demo-video.ts first.');
    process.exit(1);
  }

  // Ensure demoSilent is 30fps and 1920x1080
  const normalizedDemo = path.join(VIDEO_DIR, 'demo-norm30.mp4');
  console.log('[3/5] Normalizing demo recording to 1080p30...');
  execSync(
    `ffmpeg -y -i "${demoSilentMp4}" -r 30 -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2" -c:v libx264 -pix_fmt yuv420p "${normalizedDemo}"`,
    { stdio: 'pipe' }
  );

  const durIntro = getDuration(cards.introMp4);
  const durDiagram = getDuration(cards.diagramMp4);
  const durDemo = getDuration(normalizedDemo);
  const durOutro = getDuration(cards.outroMp4);

  console.log(`\nClip Durations:`);
  console.log(`  - Intro Card:   ${durIntro.toFixed(2)}s`);
  console.log(`  - Diagram Card: ${durDiagram.toFixed(2)}s`);
  console.log(`  - Demo Screen:  ${durDemo.toFixed(2)}s`);
  console.log(`  - Outro Card:   ${durOutro.toFixed(2)}s`);

  // Step 4: Concatenation with 0.3s xfade
  console.log('\n[4/5] Concatenating clips with 0.3s crossfade transitions...');
  const transition = 0.3;
  const offset1 = durIntro - transition;
  const offset2 = offset1 + durDiagram - transition;
  const offset3 = offset2 + durDemo - transition;

  const xfadeFilter =
    `[0:v][1:v]xfade=transition=fade:duration=${transition}:offset=${offset1.toFixed(2)}[v01];` +
    `[v01][2:v]xfade=transition=fade:duration=${transition}:offset=${offset2.toFixed(2)}[v012];` +
    `[v012][3:v]xfade=transition=fade:duration=${transition}:offset=${offset3.toFixed(2)}[vout]`;

  const concatVideoOnly = path.join(VIDEO_DIR, 'concat-silent.mp4');
  execSync(
    `ffmpeg -y -i "${cards.introMp4}" -i "${cards.diagramMp4}" -i "${normalizedDemo}" -i "${cards.outroMp4}" ` +
      `-filter_complex "${xfadeFilter}" -map "[vout]" -c:v libx264 -pix_fmt yuv420p -r 30 "${concatVideoOnly}"`,
    { stdio: 'inherit' }
  );

  const totalVideoDuration = getDuration(concatVideoOnly);
  console.log(`\nConcatenated video duration: ${totalVideoDuration.toFixed(2)}s`);

  // Step 5: Multiplex Audio and Finalize MP4
  console.log('\n[5/5] Mixing voiceover audio and mastering MissionPay-demo.mp4...');
  execSync(
    `ffmpeg -y -i "${concatVideoOnly}" -i "${audioPath}" ` +
      `-map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -af "apad" -t ${totalVideoDuration.toFixed(2)} "${FINAL_OUTPUT}"`,
    { stdio: 'inherit' }
  );

  const finalDuration = getDuration(FINAL_OUTPUT);
  const finalSize = fs.statSync(FINAL_OUTPUT).size;
  const finalSizeMB = (finalSize / (1024 * 1024)).toFixed(2);

  console.log('\n================================================================');
  console.log('   MISSIONPAY POST-PRODUCTION COMPLETE!                         ');
  console.log('================================================================');
  console.log(`- Final File:   ${FINAL_OUTPUT}`);
  console.log(`- Duration:     ${Math.floor(finalDuration / 60)}m ${(finalDuration % 60).toFixed(1)}s (${finalDuration.toFixed(2)}s)`);
  console.log(`- Target:       2:40 – 2:55 (Reviewer Spec)`);
  console.log(`- File Size:    ${finalSizeMB} MB (< 50 MB Git Threshold)`);
  console.log(`- Audio Track:  ${customVoicePath ? 'Track B (Owner Human Voice)' : 'Track A (Draft edge-tts en-US-AndrewNeural)'}`);
  console.log('================================================================\n');
}

main().catch((err) => {
  console.error('Error during build-video:', err);
  process.exit(1);
});
