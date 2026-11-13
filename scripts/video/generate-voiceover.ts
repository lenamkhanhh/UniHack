import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const ROOT = path.resolve(__dirname, '../..');
const VIDEO_DIR = path.resolve(ROOT, 'artifacts/submission-s1/video');

interface Clip {
  id: string;
  file: string;
  text: string;
  delayMs: number;
}

const CLIPS: Clip[] = [
  {
    id: 'intro',
    file: 'clip_intro.mp3',
    text: 'Same vendor. Same treasury. Two outcomes.',
    delayMs: 500, // Starts at 0.5s during title card
  },
  {
    id: 'diagram',
    file: 'clip_diagram.mp3',
    text: 'Off-chain agents propose payouts, while Avalanche smart contracts enforce deterministic cryptographic limits.',
    delayMs: 4000, // Starts at 4.0s during architecture diagram
  },
  {
    id: 's0',
    file: 'clip_s0.mp3',
    text: 'On Avalanche Fuji, our Twin Treasury shows the difference: a global allowlist leaks funds, but MissionPay reverts the attack on-chain.',
    delayMs: 11000, // Starts at 11.0s during S0
  },
  {
    id: 's1',
    file: 'clip_s1.mp3',
    text: 'In Judge Mode, test any attacker address: the smart contract strictly rejects it with PayeeNotInMissionSet, while legitimate payees succeed.',
    delayMs: 36000, // Starts at 36.0s during S1
  },
  {
    id: 's2',
    file: 'clip_s2.mp3',
    text: 'In our public Bounty challenge, prompt injection fools the agent, but our dual-layer guard stops the payout with zero dollars lost.',
    delayMs: 66000, // Starts at 66.0s during S2
  },
  {
    id: 's3',
    file: 'clip_s3.mp3',
    text: 'Snowtrace confirms the real transaction: execution strictly reverted on-chain with the custom error PayeeNotInMissionSet.',
    delayMs: 96000, // Starts at 96.0s during S3
  },
  {
    id: 's4',
    file: 'clip_s4.mp3',
    text: 'Every step is cryptographically anchored. Tampering with a single byte instantly breaks the hash chain, turning the verifier red.',
    delayMs: 121000, // Starts at 121.0s during S4
  },
  {
    id: 'outro',
    file: 'clip_outro.mp3',
    text: "LLMs can be fooled. Budgets on Avalanche can't. Sign once, chain enforces.",
    delayMs: 151000, // Starts at 151.0s during Outro card
  },
];

export async function generateMasterVoiceover(outputFile?: string): Promise<string> {
  const masterAudio = outputFile || path.join(VIDEO_DIR, 'voiceover-draft.mp3');
  console.log('Generating voiceover clips using edge-tts (voice: en-US-AndrewNeural)...');

  for (const clip of CLIPS) {
    const clipPath = path.join(VIDEO_DIR, clip.file);
    console.log(`- Generating [${clip.id}]: "${clip.text}"`);
    // Escape double quotes inside text
    const escapedText = clip.text.replace(/"/g, '\\"');
    execSync(`edge-tts --voice en-US-AndrewNeural --text "${escapedText}" --write-media "${clipPath}"`, {
      stdio: 'pipe',
    });
  }

  console.log('\nMixing clips into timeline with EBU R128 loudnorm filter...');
  const inputs = CLIPS.map((c) => `-i "${path.join(VIDEO_DIR, c.file)}"`).join(' ');
  const delays = CLIPS.map((c, i) => `[${i}:a]adelay=${c.delayMs}|${c.delayMs}[a${i}]`).join(';');
  const amixInputs = CLIPS.map((_, i) => `[a${i}]`).join('');
  const filter = `${delays};${amixInputs}amix=inputs=${CLIPS.length}:dropout_transition=0,loudnorm=I=-16:TP=-1.5:LRA=11`;

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
