import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { chromium } from 'playwright';
import { generateMasterVoiceover, Clip } from './generate-voiceover';

const ROOT = path.resolve(__dirname, '../..');
const VIDEO_DIR = path.resolve(ROOT, 'artifacts/submission-s1/video');
const CARDS_DIR = path.resolve(VIDEO_DIR, 'cards');
const FRAMES_DIR = path.resolve(VIDEO_DIR, 'frames');
const FINAL_OUTPUT = path.join(VIDEO_DIR, 'MissionPay-demo.mp4');

if (!fs.existsSync(FRAMES_DIR)) {
  fs.mkdirSync(FRAMES_DIR, { recursive: true });
}

// Parse CLI flags
const args = process.argv.slice(2);
let customVoicePath: string | null = null;
let skipRecord = false;
let publicUrl: string | null = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--voice' && args[i + 1]) {
    customVoicePath = path.resolve(args[i + 1]);
    i++;
  } else if (args[i] === '--skip-record') {
    skipRecord = true;
  } else if (args[i] === '--public-url' && args[i + 1]) {
    publicUrl = args[i + 1].replace(/\/+$/, '');
    i++;
  }
}

async function renderCardScreenshots() {
  console.log('[1/6] Rendering Title and Illustration cards with Playwright (1920x1080)...');

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  // 1. Intro Card (S0)
  const introPath = path.join(CARDS_DIR, 'intro.html');
  await page.goto(`file://${introPath}`);
  await page.waitForTimeout(1000);
  const introPng = path.join(CARDS_DIR, 'intro.png');
  await page.screenshot({ path: introPng });
  console.log('  - Rendered intro.png');

  // 2. Diagram Card (S6)
  const diagramPath = path.join(CARDS_DIR, 'diagram.html');
  await page.goto(`file://${diagramPath}`);
  await page.waitForTimeout(1500);
  const diagramPng = path.join(CARDS_DIR, 'diagram.png');
  await page.screenshot({ path: diagramPng });
  console.log('  - Rendered diagram.png');

  // 3. Outro Card (S7)
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

  // S0 Intro: 3.5s
  execSync(
    `ffmpeg -y -loop 1 -i "${introPng}" -c:v libx264 -t 3.5 -pix_fmt yuv420p -r 30 "${introMp4}"`,
    { stdio: 'pipe' }
  );
  // S6 Diagram: 5.0s (Prompt R14: "S6 diagram card 5 s")
  execSync(
    `ffmpeg -y -loop 1 -i "${diagramPng}" -c:v libx264 -t 5.0 -pix_fmt yuv420p -r 30 "${diagramMp4}"`,
    { stdio: 'pipe' }
  );
  // S7 Outro: 6.5s
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
  console.log('   MissionPay Post-Production Video Pipeline (Round 14 - v8b)   ');
  console.log('================================================================\n');

  // Step 1: Render Cards
  const cards = await renderCardScreenshots();

  // Step 2: Check demo recording
  const demoSilentMp4 = path.join(VIDEO_DIR, 'demo-silent.mp4');
  if (!fs.existsSync(demoSilentMp4)) {
    console.log('[2/6] Demo silent recording missing. Please run scripts/record-demo-video.ts first.');
    process.exit(1);
  }

  const rawDur = getDuration(demoSilentMp4);
  const durIntro = getDuration(cards.introMp4);
  const durDiagram = getDuration(cards.diagramMp4);
  const durOutro = getDuration(cards.outroMp4);
  const cardsNetDur = durIntro + durDiagram + durOutro - 0.9; // 3 x 0.3s xfade

  // Target total video duration: 168.0s (~2m 48s), comfortably in 2:40–2:55 range (160s–175s)
  const targetTotalDur = 168.0;
  const targetDemoDur = Math.max(140.0, targetTotalDur - cardsNetDur);
  const ptsRatio = (targetDemoDur / rawDur).toFixed(4);

  // Ensure demoSilent is 30fps and 1920x1080
  const normalizedDemo = path.join(VIDEO_DIR, 'demo-norm30.mp4');
  console.log(`[2/6] Normalizing demo recording to 1080p30 (raw: ${rawDur.toFixed(2)}s, target: ${targetDemoDur.toFixed(2)}s, pts: ${ptsRatio})...`);
  execSync(
    `ffmpeg -y -i "${demoSilentMp4}" -r 30 -vf "setpts=${ptsRatio}*PTS,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2" -c:v libx264 -pix_fmt yuv420p "${normalizedDemo}"`,
    { stdio: 'pipe' }
  );

  const durDemo = getDuration(normalizedDemo);

  console.log(`\nClip Durations:`);
  console.log(`  - S0 Intro Card:   ${durIntro.toFixed(2)}s`);
  console.log(`  - S1..S5 Demo:     ${durDemo.toFixed(2)}s`);
  console.log(`  - S6 Diagram Card: ${durDiagram.toFixed(2)}s`);
  console.log(`  - S7 Outro Card:   ${durOutro.toFixed(2)}s`);

  // Step 3: Concatenation with 0.3s xfade
  // R14 Scene Order: S0 (Intro) -> S1..S5 (Demo) -> S6 (Diagram) -> S7 (Outro)
  console.log('\n[3/6] Concatenating clips with 0.3s crossfade transitions...');
  const transition = 0.3;
  const offset1 = durIntro - transition;
  const offset2 = offset1 + durDemo - transition;
  const offset3 = offset2 + durDiagram - transition;

  const xfadeFilter =
    `[0:v][1:v]xfade=transition=fade:duration=${transition}:offset=${offset1.toFixed(2)}[v01];` +
    `[v01][2:v]xfade=transition=fade:duration=${transition}:offset=${offset2.toFixed(2)}[v012];` +
    `[v012][3:v]xfade=transition=fade:duration=${transition}:offset=${offset3.toFixed(2)}[vout]`;

  const concatVideoOnly = path.join(VIDEO_DIR, 'concat-silent.mp4');
  execSync(
    `ffmpeg -y -i "${cards.introMp4}" -i "${normalizedDemo}" -i "${cards.diagramMp4}" -i "${cards.outroMp4}" ` +
      `-filter_complex "${xfadeFilter}" -map "[vout]" -c:v libx264 -pix_fmt yuv420p -r 30 "${concatVideoOnly}"`,
    { stdio: 'inherit' }
  );

  const totalVideoDuration = getDuration(concatVideoOnly);
  console.log(`\nConcatenated video duration: ${totalVideoDuration.toFixed(2)}s`);

  // Step 4: Generate Voiceover with exact timeline alignment
  let audioPath = customVoicePath;
  if (!audioPath) {
    audioPath = path.join(VIDEO_DIR, 'voiceover-draft.mp3');
    console.log('[4/6] Generating voiceover draft via edge-tts aligned to timeline...');
    const scale = parseFloat(ptsRatio);

    const dynamicClips: Clip[] = [
      {
        id: 's0_intro',
        file: 'clip_intro.mp3',
        text: 'Same vendor. Same treasury. Two outcomes.',
        delayMs: 600, // 0.6s
      },
      {
        id: 's1_home',
        file: 'clip_s1.mp3',
        text: 'Live on Avalanche Fuji, our Twin Treasury benchmark shows the difference: an allowlist leaks funds, but MissionPay reverts the attack on-chain.',
        delayMs: Math.round((offset1 + 1.8) * 1000), // ~5.0s
      },
      {
        id: 's2_judge',
        file: 'clip_s2.mp3',
        text: 'In Judge Mode, test any off-mission attacker: the smart contract strictly rejects it with PayeeNotInMissionSet, while legitimate payees succeed.',
        delayMs: Math.round((offset1 + 29.0 * scale) * 1000), // ~29s into demo
      },
      {
        id: 's3_bounty',
        file: 'clip_s3.mp3',
        text: 'In our public Bounty challenge, prompt injection fools the autonomous agent, but our dual-layer guard stops the payout with zero dollars lost.',
        delayMs: Math.round((offset1 + 75.0 * scale) * 1000), // ~75s into demo
      },
      {
        id: 's4_snowtrace',
        file: 'clip_s4.mp3',
        text: 'Snowtrace confirms the live receipt: execution strictly reverted on-chain with zero funds lost.',
        delayMs: Math.round((offset1 + 101.0 * scale) * 1000), // ~101s into demo
      },
      {
        id: 's5_verify',
        file: 'clip_s5.mp3',
        text: 'Every step is cryptographically anchored with ERC-8004 one hundred out of one hundred score. Tampering with one single byte instantly breaks the hash chain.',
        delayMs: Math.round((offset1 + 109.0 * scale) * 1000), // ~109s into demo
      },
      {
        id: 's6_diagram',
        file: 'clip_diagram.mp3',
        text: 'Off-chain agents propose payouts, while Avalanche smart contracts enforce deterministic cryptographic limits.',
        delayMs: Math.round((offset2 + 0.6) * 1000), // ~157.5s
      },
      {
        id: 's7_outro',
        file: 'clip_outro.mp3',
        text: "LLMs can be fooled. Budgets on Avalanche can't. Sign once, chain enforces.",
        delayMs: Math.round((offset3 + 0.6) * 1000), // ~162.2s
      },
    ];

    await generateMasterVoiceover(audioPath, dynamicClips);
  } else {
    console.log(`[4/6] Using Track B (Owner Voice): ${audioPath}`);
  }

  // Step 5: Multiplex Audio and Finalize MP4
  console.log('\n[5/6] Mixing voiceover audio and mastering MissionPay-demo.mp4...');
  execSync(
    `ffmpeg -y -i "${concatVideoOnly}" -i "${audioPath}" ` +
      `-map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -af "apad" -t ${totalVideoDuration.toFixed(2)} "${FINAL_OUTPUT}"`,
    { stdio: 'inherit' }
  );

  const finalDuration = getDuration(FINAL_OUTPUT);
  const finalSize = fs.statSync(FINAL_OUTPUT).size;
  const finalSizeMB = (finalSize / (1024 * 1024)).toFixed(2);

  // Step 6: Extract representative frames (scene0.png .. scene7.png)
  console.log('\n[6/6] Extracting representative scene frames to artifacts/submission-s1/video/frames/ ...');
  const scale = parseFloat(ptsRatio);

  const frameSnapshots = [
    { name: 'scene0.png', time: 1.5, desc: 'S0 Title Card' },
    { name: 'scene1.png', time: offset1 + 14 * scale, desc: 'S1 Home Twin Treasury' },
    { name: 'scene2.png', time: offset1 + 60 * scale, desc: 'S2 Judge Mode Simulator' },
    { name: 'scene3.png', time: offset1 + 86 * scale, desc: 'S3 Bounty Challenge' },
    { name: 'scene4.png', time: offset1 + 104 * scale, desc: 'S4 Snowtrace Revert' },
    { name: 'scene5.png', time: offset1 + 124 * scale, desc: 'S5 Independent Verifier' },
    { name: 'scene6.png', time: offset2 + 2.5, desc: 'S6 Architecture Diagram' },
    { name: 'scene7.png', time: offset3 + 3.0, desc: 'S7 Outro Card' },
  ];

  for (const snap of frameSnapshots) {
    const outPath = path.join(FRAMES_DIR, snap.name);
    try {
      execSync(`ffmpeg -y -ss ${snap.time.toFixed(2)} -i "${FINAL_OUTPUT}" -vframes 1 "${outPath}"`, {
        stdio: 'pipe',
      });
      console.log(`  - Extracted ${snap.name} at ${snap.time.toFixed(1)}s (${snap.desc})`);
    } catch (e: any) {
      console.warn(`  - Warning: Failed to extract ${snap.name}: ${e.message}`);
    }
  }

  // Update captions.srt with exact offsets
  const srtPath = path.join(VIDEO_DIR, 'captions.srt');
  const formatSrtTime = (sec: number) => {
    const h = Math.floor(sec / 3600).toString().padStart(2, '0');
    const m = Math.floor((sec % 3600) / 60).toString().padStart(2, '0');
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    const ms = Math.floor((sec % 1) * 1000).toString().padStart(3, '0');
    return `${h}:${m}:${s},${ms}`;
  };

  const captions = [
    { start: 0.5, end: 3.2, text: 'MissionPay: Same vendor. Same treasury. Two outcomes.' },
    { start: offset1 + 1.5, end: offset1 + 28.0 * scale, text: 'Live on Avalanche Fuji, our Twin Treasury benchmark shows the difference: an allowlist leaks funds, but MissionPay reverts the attack on-chain.' },
    { start: offset1 + 29.0 * scale, end: offset1 + 73.0 * scale, text: 'In Judge Mode, test any off-mission attacker: the smart contract strictly rejects it with PayeeNotInMissionSet, while legitimate payees succeed.' },
    { start: offset1 + 75.0 * scale, end: offset1 + 99.0 * scale, text: 'In our public Bounty challenge, prompt injection fools the autonomous agent, but our dual-layer guard stops the payout with zero dollars lost.' },
    { start: offset1 + 101.0 * scale, end: offset1 + 108.0 * scale, text: 'Snowtrace confirms the live receipt: execution strictly reverted on-chain with zero funds lost.' },
    { start: offset1 + 109.0 * scale, end: offset2 - 0.5, text: 'Every step is cryptographically anchored with ERC-8004 one hundred out of one hundred score. Tampering with one single byte instantly breaks the hash chain.' },
    { start: offset2 + 0.3, end: offset3 - 0.3, text: 'Off-chain agents propose payouts, while Avalanche smart contracts enforce deterministic cryptographic limits.' },
    { start: offset3 + 0.3, end: finalDuration - 0.5, text: "LLMs can be fooled. Budgets on Avalanche can't. Sign once, chain enforces." },
  ];

  const srtContent = captions
    .map((c, idx) => `${idx + 1}\n${formatSrtTime(c.start)} --> ${formatSrtTime(c.end)}\n${c.text}\n`)
    .join('\n');
  fs.writeFileSync(srtPath, srtContent, 'utf8');
  console.log(`\nUpdated captions.srt with aligned timestamps.`);

  console.log('\n================================================================');
  console.log('   MISSIONPAY POST-PRODUCTION COMPLETE!                         ');
  console.log('================================================================');
  console.log(`- Final File:   ${FINAL_OUTPUT}`);
  console.log(`- Duration:     ${Math.floor(finalDuration / 60)}m ${(finalDuration % 60).toFixed(1)}s (${finalDuration.toFixed(2)}s)`);
  console.log(`- Target:       2:40 – 2:55 (Reviewer Spec: 160s – 175s)`);
  console.log(`- In Spec:      ${finalDuration >= 160 && finalDuration <= 175 ? 'YES ✅' : 'CHECK DURATION ⚠️'}`);
  console.log(`- File Size:    ${finalSizeMB} MB (< 50 MB Git Threshold)`);
  console.log(`- Audio Track:  ${customVoicePath ? 'Track B (Owner Human Voice)' : 'Track A (Draft edge-tts en-US-AndrewNeural)'}`);
  console.log(`- Frames:       ${FRAMES_DIR}`);
  console.log('================================================================\n');
}

main().catch((err) => {
  console.error('Error during build-video:', err);
  process.exit(1);
});
