// Scene definitions for the MissionPay demo (r21: fixed framing, rare eased zoom, callouts).
// Usage (from apps/web, so @playwright/test resolves):
//   node ../../scripts/video/render-scenes.mjs --out <dir> [--only s1a,s1b] [--base https://...]
// Scene length = voice clip + LEAD + TAIL; the voice clip starts LEAD seconds into the scene.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Renderer, VW, VH, composeToVideo } from './render-engine.mjs';
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
const BASE = arg('base', 'https://unihack-missionpay.vercel.app');
fs.mkdirSync(OUT, { recursive: true });

export const CLIP = {
  s0: 'clip_s0_r18', s1a: 'clip_s1a_r18', s1b: 'clip_s1b_r18', s1c1: 'clip_s1c1_r18', s1c2: 'clip_s1c2_r18',
  s1c3: 'clip_s1c3_r18', s2a: 'clip_s2a_r18', s2b: 'clip_s2b_r18', s2c: 'clip_s2c_r18', s2d: 'clip_s2d_r18',
  s2e: 'clip_s2e_r18', s3a: 'clip_s3a_r18', s3b: 'clip_s3b_r18', s4: 'clip_s4_r18', s5a: 'clip_s5a_r18',
  s5b: 'clip_s5b_r18', s5c: 'clip_s5c_r18', s6: 'clip_s6_r18', s7: 'clip_s7_r18',
};
const speechDur = (id) => JSON.parse(fs.readFileSync(path.join(VIDEO_DIR, CLIP[id] + '.meta.json'), 'utf8')).duration;
export const sceneLen = (id) => +(speechDur(id) + LEAD + TAIL).toFixed(3);
export const at = (id, frac) => LEAD + frac * speechDur(id);

const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const R = new Renderer({ baseUrl: BASE, workDir: OUT });

// scroll position that puts the centre of doc box b at fraction ay of the viewport height
export async function syFor(b, ay = 0.5) {
  const H = await R.docH();
  return Math.round(clamp(b.y + b.h / 2 - ay * VH, 0, Math.max(0, H - VH)));
}
export const center = (b, dy = 0, dx = 0) => ({ x: b.x + b.w / 2 + dx, y: b.y + b.h / 2 + dy });
export const cardsFile = (n) => pathToFileURL(path.join(VIDEO_DIR, 'cards', n)).href;
// zoom keys: ease once (0.7 s) from z=1 to zz around (cx, cy) starting at t0, then hold exactly
export const zoomOnce = (t0, zz, cx, cy, ease = 0.7) => [
  { t: 0, z: 1, cx: VW / 2, cy: VH / 2 },
  { t: t0, z: 1, cx: VW / 2, cy: VH / 2 },
  { t: t0 + ease, z: zz, cx, cy },
];
// climb from an element to its surrounding card (width 300-520, height > 200) for callout boxes
export async function cardBox(locator) {
  return locator.evaluate((e) => {
    let n = e;
    for (let i = 0; i < 8 && n.parentElement; i++) {
      const r = n.getBoundingClientRect();
      if (r.width >= 300 && r.width <= 520 && r.height >= 200) break;
      n = n.parentElement;
    }
    const r = n.getBoundingClientRect();
    return { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height };
  });
}
// the intro/diagram/outro cards are designed 1920x1080: scale them to the 1920x950 page area
export async function fitCard() {
  await R.page.evaluate(() => {
    const b = document.body;
    document.documentElement.style.background = getComputedStyle(b).backgroundColor;
    document.documentElement.style.overflow = 'hidden';
    b.style.transformOrigin = 'top center';
    b.style.transform = 'scale(0.8796)';
    b.style.margin = '0 auto';
  });
}

const SCENES = {};

SCENES.s0 = async () => {
  await R.goto(cardsFile('intro.html'), true);
  await fitCard();
  return { dur: sceneLen('s0'), sy: 0 };
};

SCENES.s1a = async () => {
  await R.goto('/', true);
  return { dur: sceneLen('s1a'), sy: 0 };
};

SCENES.s1b = async () => {
  const dur = sceneLen('s1b');
  await R.goto('/', true);
  const names = ['The owner signs a mission', 'The agent can only propose', 'The contract has the last word'];
  const cards = [];
  for (const n of names) cards.push(await cardBox(R.page.getByText(n).first()));
  const span = { x: cards[0].x, y: cards[0].y, w: cards[2].x + cards[2].w - cards[0].x, h: cards[0].h };
  const sy = await syFor(span, 0.45);
  const labels = ['1  Owner signs the mission', '2  Agent only proposes', '3  Contract has the last word'];
  const fr = [0.0, 0.36, 0.63];
  const frEnd = [0.36, 0.63, 1.0];
  const hl = cards.map((b, i) => ({
    t0: at('s1b', fr[i]) + (i === 0 ? 0.3 : 0),
    t1: i === 2 ? dur - 0.3 : at('s1b', frEnd[i]),
    box: b,
    label: labels[i],
    tagAt: { x: b.x - 8, y: b.y - 52 },
  }));
  return { dur, sy, hl };
};

// Twin Treasury table: one eased zoom in the first scene, then the same fixed framing for the next two
let twin = null;
async function twinGeom() {
  if (twin) return twin;
  await R.goto('/', true);
  const table = await R.box('section[aria-labelledby="twin-heading"] table');
  const r1 = await R.box('section[aria-labelledby="twin-heading"] tbody tr:nth-child(1)');
  const r2 = await R.box('section[aria-labelledby="twin-heading"] tbody tr:nth-child(2)');
  const link = await R.box('section[aria-labelledby="twin-heading"] tbody tr:nth-child(2) a');
  const sy = await syFor(table, 0.42);
  const zc = { cx: table.x + table.w / 2, cy: table.y + table.h / 2 - sy };
  twin = { table, r1, r2, link, sy, zc, ZZ: 1.38, tag: { x: table.x + table.w - 400, y: table.y - 66 } };
  return twin;
}
SCENES.s1c1 = async () => {
  const dur = sceneLen('s1c1');
  const g = await twinGeom();
  await R.goto('/', true);
  const p = center(g.r1, 0, 300);
  return {
    dur,
    sy: g.sy,
    zoom: zoomOnce(0.5, g.ZZ, g.zc.cx, g.zc.cy),
    cursor: [
      { t: 0.4, x: g.table.x + g.table.w + 120, y: g.table.y - 40 },
      { t: at('s1c1', 0.45), x: p.x, y: p.y },
    ],
    hl: [{ t0: LEAD, t1: dur - 0.3, box: g.r1, label: 'Allowlist mode: PAID to the vendor', tagAt: g.tag }],
  };
};
SCENES.s1c2 = async () => {
  const dur = sceneLen('s1c2');
  const g = await twinGeom();
  await R.goto('/', true);
  const p1 = center(g.r1, 0, 300);
  const p2 = center(g.r2, 0, 300);
  return {
    dur,
    sy: g.sy,
    zoom: [{ t: 0, z: g.ZZ, cx: g.zc.cx, cy: g.zc.cy }],
    cursor: [
      { t: 0.1, x: p1.x, y: p1.y },
      { t: at('s1c2', 0.4), x: p2.x, y: p2.y },
    ],
    hl: [{ t0: LEAD, t1: dur - 0.3, box: g.r2, label: 'Mission mode: REVERTED, 0 lost', tagAt: g.tag }],
  };
};
SCENES.s1c3 = async () => {
  const dur = sceneLen('s1c3');
  const g = await twinGeom();
  await R.goto('/', true);
  const p2 = center(g.r2, 0, 300);
  const lk = center(g.link);
  return {
    dur,
    sy: g.sy,
    zoom: [{ t: 0, z: g.ZZ, cx: g.zc.cx, cy: g.zc.cy }],
    cursor: [
      { t: 0.1, x: p2.x, y: p2.y },
      { t: at('s1c3', 0.4), x: lk.x, y: lk.y },
    ],
    hl: [{ t0: LEAD, t1: dur - 0.3, box: g.link, label: 'Real Fuji transaction receipt', tagAt: g.tag }],
  };
};

registerScenes(SCENES, { R, LEAD, sceneLen, at, syFor, center, cardsFile, cardBox, fitCard, zoomOnce, OUT, ROOT, VIDEO_DIR });

const todo = ONLY.length ? ONLY : Object.keys(SCENES);
await R.open();
try {
  for (const id of todo) {
    if (!SCENES[id]) {
      console.log('skip unknown scene', id);
      continue;
    }
    const t0 = Date.now();
    const scene = await SCENES[id]();
    const { manifest, shots } = await R.render(scene, id);
    const out = path.join(OUT, `${id}.mp4`);
    await composeToVideo(manifest, out);
    console.log(`[scene ${id}] ${scene.dur.toFixed(2)}s, ${shots} screenshots -> ${out} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
} finally {
  await R.close();
}
