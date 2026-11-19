// Scene definitions for the MissionPay demo (Claude-built, frame-stepped).
// Usage (from apps/web, so @playwright/test resolves):
//   node ../../scripts/video/render-scenes.mjs --out <dir> [--only s1a,s1b] [--preview] [--base https://...]
// Each scene lasts  dur(clip) + LEAD + TAIL  seconds; the voice clip starts LEAD seconds into the scene.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Renderer, VW, VH } from './render-engine.mjs';
import { registerScenes } from './scenes-judge-onward.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const VIDEO_DIR = path.join(ROOT, 'artifacts/submission-s1/video');
export const LEAD = 0.8;
export const TAIL = 0.9;

const args = process.argv.slice(2);
const arg = (n, d) => {
  const i = args.indexOf('--' + n);
  return i >= 0 ? args[i + 1] : d;
};
const OUT = arg('out', path.join(process.env.TEMP || '/tmp', 'mp-video'));
const ONLY = arg('only', '')
  .split(',')
  .filter(Boolean);
const PREVIEW = args.includes('--preview');
const BASE = arg('base', 'https://unihack-missionpay.vercel.app');
fs.mkdirSync(OUT, { recursive: true });

export const CLIP = {
  s0: 'clip_s0_r18', s1a: 'clip_s1a_r18', s1b: 'clip_s1b_r18', s1c1: 'clip_s1c1_r18', s1c2: 'clip_s1c2_r18',
  s1c3: 'clip_s1c3_r18', s2a: 'clip_s2a_r18', s2b: 'clip_s2b_r18', s2c: 'clip_s2c_r18', s2d: 'clip_s2d_r18',
  s2e: 'clip_s2e_r18', s3a: 'clip_s3a_r18', s3b: 'clip_s3b_r18', s4: 'clip_s4_r18', s5a: 'clip_s5a_r18',
  s5b: 'clip_s5b_r18', s5c: 'clip_s5c_r18', s6: 'clip_s6_r18', s7: 'clip_s7_r18',
};
const speechDur = (id) => JSON.parse(fs.readFileSync(path.join(VIDEO_DIR, CLIP[id] + '.meta.json'), 'utf8')).duration;
const sceneLen = (id) => +(speechDur(id) + LEAD + TAIL).toFixed(3);
// fractions of the speech where a phrase starts -> absolute scene time
const at = (id, frac) => LEAD + frac * speechDur(id);

const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

const R = new Renderer({ baseUrl: BASE, dsf: PREVIEW ? 1 : 1.5 });

// camera keyframe that looks at doc-space box b
async function docH() {
  return R.page.evaluate(() => document.documentElement.scrollHeight);
}
async function look(b, { z = 1, ay = 0.5, t, dx = 0 }) {
  const H = await docH();
  const cyDoc = b.y + b.h / 2;
  const sy = clamp(cyDoc - ay * VH, 0, Math.max(0, H - VH));
  return { t, sy, cx: b.x + b.w / 2 + dx, cy: cyDoc - sy, z };
}
const center = (b, dy = 0, dx = 0) => ({ x: b.x + b.w / 2 + dx, y: b.y + b.h / 2 + dy });
const cardsFile = (n) => pathToFileURL(path.join(VIDEO_DIR, 'cards', n)).href;

// ---------------------------------------------------------------- scenes
const SCENES = {};

// Title card: slow one-direction push-in
SCENES.s0 = async () => {
  const dur = sceneLen('s0');
  await R.goto(cardsFile('intro.html'));
  return { dur, cam: [{ t: 0, sy: 0, cx: 960, cy: 540, z: 1 }, { t: dur, sy: 0, cx: 980, cy: 520, z: 1.07 }] };
};

SCENES.s1a = async () => {
  const dur = sceneLen('s1a');
  await R.goto('/');
  await R.page.evaluate(() => window.scrollTo(0, 0));
  return {
    dur,
    cam: [{ t: 0, sy: 0, cx: 960, cy: 540, z: 1 }, { t: dur, sy: 0, cx: 1120, cy: 440, z: 1.24 }],
  };
};

SCENES.s1b = async () => {
  const dur = sceneLen('s1b');
  await R.goto('/');
  const c1 = await R.box(R.page.getByText('The owner signs a mission').first());
  const c2 = await R.box(R.page.getByText('The agent can only propose').first());
  const c3 = await R.box(R.page.getByText('The contract has the last word').first());
  const row = { x: c1.x, y: c1.y - 100, w: c3.x + c3.w - c1.x + 40, h: 330 };
  const kEnd = await look(row, { z: 1.42, t: dur, ay: 0.5 });
  const kStart = { t: 0, sy: Math.max(0, kEnd.sy - 330), cx: 960, cy: 540, z: 1 };
  const p = (b) => ({ x: b.x + 150, y: b.y - 60 });
  return {
    dur,
    cam: [kStart, kEnd],
    cursor: [
      { t: 0.6, x: 1640, y: kEnd.sy + 760 },
      { t: at('s1b', 0.38), ...p(c1) },
      { t: at('s1b', 0.62), ...p(c2) },
      { t: at('s1b', 0.88), ...p(c3) },
    ],
  };
};

// Twin Treasury table: continuous camera path across three scenes (row 1 -> row 2 -> link)
let twin = null;
async function twinGeom() {
  if (twin) return twin;
  await R.goto('/');
  const table = await R.box('section[aria-labelledby="twin-heading"] table');
  const r1 = await R.box('section[aria-labelledby="twin-heading"] tbody tr:nth-child(1)');
  const r2 = await R.box('section[aria-labelledby="twin-heading"] tbody tr:nth-child(2)');
  const link = await R.box('section[aria-labelledby="twin-heading"] tbody tr:nth-child(2) a');
  const k0 = await look(table, { z: 1.05, t: 0 });
  const kR1 = await look({ ...r1, x: table.x, w: table.w }, { z: 1.4 });
  const kR2 = await look({ ...r2, x: table.x, w: table.w }, { z: 1.56 });
  const kLink = await look({ ...r2, x: table.x, w: table.w }, { z: 1.74, dx: 80 });
  twin = { table, r1, r2, link, k0, kR1, kR2, kLink };
  return twin;
}
SCENES.s1c1 = async () => {
  const dur = sceneLen('s1c1');
  const g = await twinGeom();
  const { x: x1, y: y1 } = center(g.r1, 0, 220);
  return {
    dur,
    cam: [{ ...g.k0, t: 0 }, { ...g.kR1, t: dur }],
    cursor: [
      { t: 0.5, x: g.table.x + g.table.w + 140, y: g.table.y - 60 },
      { t: at('s1c1', 0.55), x: x1, y: y1 },
      { t: dur, x: x1 + 40, y: y1 + 4 },
    ],
  };
};
SCENES.s1c2 = async () => {
  const dur = sceneLen('s1c2');
  const g = await twinGeom();
  const { x: x1, y: y1 } = center(g.r1, 0, 220);
  const { x: x2, y: y2 } = center(g.r2, 0, 260);
  return {
    dur,
    cam: [{ ...g.kR1, t: 0 }, { ...g.kR2, t: dur }],
    cursor: [
      { t: 0.5, x: x1 + 40, y: y1 + 4 },
      { t: at('s1c2', 0.5), x: x2, y: y2 },
      { t: dur, x: x2 + 40, y: y2 + 4 },
    ],
  };
};
SCENES.s1c3 = async () => {
  const dur = sceneLen('s1c3');
  const g = await twinGeom();
  const { x: x2, y: y2 } = center(g.r2, 0, 260);
  const lk = center(g.link);
  return {
    dur,
    cam: [{ ...g.kR2, t: 0 }, { ...g.kLink, t: dur }],
    cursor: [
      { t: 0.5, x: x2 + 40, y: y2 + 4 },
      { t: at('s1c3', 0.55), x: lk.x, y: lk.y },
      { t: dur, x: lk.x + 4, y: lk.y + 2 },
    ],
  };
};

registerScenes(SCENES, { R, sceneLen, at, look, center, cardsFile, OUT, ROOT, VIDEO_DIR });

const sceneIds = Object.keys(SCENES);
const todo = ONLY.length ? ONLY : sceneIds;

await R.open();
try {
  for (const id of todo) {
    if (!SCENES[id]) {
      console.log('skip unknown scene', id);
      continue;
    }
    const t0 = Date.now();
    const scene = await SCENES[id]();
    const out = path.join(OUT, `${id}${PREVIEW ? '_pv' : ''}.mp4`);
    await R.render(scene, out, { preview: PREVIEW });
    console.log(`[scene ${id}] ${scene.dur.toFixed(2)}s -> ${out} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
} finally {
  await R.close();
}
