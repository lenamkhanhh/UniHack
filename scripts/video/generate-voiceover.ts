import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const ROOT = path.resolve(__dirname, '../..');
const VIDEO_DIR = path.resolve(ROOT, 'artifacts/submission-s1/video');

export interface Clip {
  id: string;
  file: string;
  text: string;
  delayMs: number;
}

export const CLIPS: Clip[] = [
  {
    id: 's0_intro',
    file: 'clip_intro.mp3',
    text: 'Same vendor. Same treasury. Two outcomes.',
    delayMs: 600, // Starts at 0.6s during Title card (0:00 - 0:03.5)
  },
  {
    id: 's1_home',
    file: 'clip_s1.mp3',
    text: 'Live on Avalanche Fuji, our Twin Treasury benchmark shows the difference: an allowlist leaks funds, but MissionPay reverts the attack on-chain.',
    delayMs: 5000, // Starts at ~5.0s during S1 Home Twin Treasury
  },
  {
    id: 's2_judge',
    file: 'clip_s2.mp3',
    text: 'In Judge Mode, test any off-mission attacker: the smart contract strictly rejects it with PayeeNotInMissionSet, while legitimate payees succeed.',
    delayMs: 30000, // Starts at ~30.0s during S2 Judge interactive simulation
  },
  {
    id: 's3_bounty',
    file: 'clip_s3.mp3',
    text: 'In our public Bounty challenge, prompt injection fools the autonomous agent, but our dual-layer guard stops the payout with zero dollars lost.',
    delayMs: 70000, // Starts at ~70.0s during S3 Bounty prompt injection run
  },
  {
    id: 's4_snowtrace',
    file: 'clip_s4.mp3',
    text: 'Snowtrace confirms the live receipt: execution strictly reverted on-chain with zero funds lost.',
    delayMs: 93000, // Starts at ~93.0s during S4 Snowtrace on-chain revert proof
  },
  {
    id: 's5_verify',
    file: 'clip_s5.mp3',
    text: 'Every step is cryptographically anchored with ERC-8004 one hundred out of one hundred score. Tampering with one single byte instantly breaks the hash chain.',
    delayMs: 100000, // Starts at ~100.0s during S5 Client-side cryptographic verifier
  },
  {
    id: 's6_diagram',
    file: 'clip_diagram.mp3',
    text: 'Off-chain agents propose payouts, while Avalanche smart contracts enforce deterministic cryptographic limits.',
    delayMs: 157500, // Starts at ~157.5s during S6 Architecture Diagram
  },
  {
    id: 's7_outro',
    file: 'clip_outro.mp3',
    text: "LLMs can be fooled. Budgets on Avalanche can't. Sign once, chain enforces.",
    delayMs: 162200, // Starts at ~162.2s during S7 Outro card
  },
];

export async function generateMasterVoiceover(
  outputFile?: string,
  customClips?: Clip[]
): Promise<string> {
  const masterAudio = outputFile || path.join(VIDEO_DIR, 'voiceover-draft.mp3');
  const clipsToUse = customClips || CLIPS;
  console.log('Generating voiceover clips using edge-tts (voice: en-US-ChristopherNeural)...');

  const voices = ['en-US-ChristopherNeural', 'en-US-GuyNeural', 'en-US-BrianNeural'];

  for (const clip of clipsToUse) {
    const clipPath = path.join(VIDEO_DIR, clip.file);
    console.log(`- Generating [${clip.id}]: "${clip.text}"`);
    const escapedText = clip.text.replace(/"/g, '\\"');
    let success = false;

    for (const v of voices) {
      try {
        execSync(`edge-tts --voice ${v} --text "${escapedText}" --write-media "${clipPath}"`, {
          stdio: 'pipe',
        });
        if (fs.existsSync(clipPath) && fs.statSync(clipPath).size > 1000) {
          success = true;
          break;
        }
      } catch (e: any) {
        console.warn(`  Warning: Voice ${v} failed for ${clip.id}, trying fallback...`);
      }
    }

    if (!success) {
      throw new Error(`Failed to generate TTS audio for clip: ${clip.id}`);
    }
  }

  console.log('\nMixing clips into timeline with EBU R128 loudnorm filter...');
  const inputs = clipsToUse.map((c) => `-i "${path.join(VIDEO_DIR, c.file)}"`).join(' ');
  const delays = clipsToUse.map((c, i) => `[${i}:a]adelay=${Math.round(c.delayMs)}|${Math.round(c.delayMs)}[a${i}]`).join(';');
  const amixInputs = clipsToUse.map((_, i) => `[a${i}]`).join('');
  const filter = `${delays};${amixInputs}amix=inputs=${clipsToUse.length}:dropout_transition=0,loudnorm=I=-16:TP=-1.5:LRA=11`;

  execSync(`ffmpeg -y ${inputs} -filter_complex "${filter}" -c:a libmp3lame -b:a 192k "${masterAudio}"`, {
    stdio: 'inherit',
  });

  console.log(`\n✅ Master voiceover created: ${masterAudio}`);
  return masterAudio;
}

if (require.main === module) {
  generateMasterVoiceover().catch((err) => {
    console.error('Voiceover generation failed:', err);
    process.exit(1);
  });
}
