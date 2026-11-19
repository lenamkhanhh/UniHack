// Deterministic, frame-stepped scene renderer for the MissionPay demo video.
//
// Why this exists: Playwright's recordVideo screencast delivers ~10 distinct frames/s, so scrolling looks
// choppy and static stretches look frozen. Here every output frame is rendered on purpose:
//   - the page state (scroll position, cursor, click ripple) is set for virtual time t,
//   - a clipped screenshot (the "camera": pan + zoom, 1 direction, eased) is taken at 1.5x device pixels,
//   - frames are piped into ffmpeg (30 fps, H.264).
// There is NO random shake/jitter anywhere: all camera motion is a smooth Hermite curve through keyframes.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';

export const FPS = 30;
export const VW = 1920;
export const VH = 1080;

// ---- interpolation: monotone cubic Hermite (PCHIP) through keyframes, no overshoot, C1 continuous ----
function pchipSlopes(ts, vs) {
  const n = ts.length;
  if (n === 1) return [0];
  const d = [];
  const h = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(ts[i + 1] - ts[i]);
    d.push((vs[i + 1] - vs[i]) / h[i]);
  }
  const m = new Array(n).fill(0);
  if (n === 2) return [d[0], d[0]];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0;
    else {
      const w1 = 2 * h[i] + h[i - 1];
      const w2 = h[i] + 2 * h[i - 1];
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
    }
  }
  m[0] = endSlope(h[0], h[1], d[0], d[1]);
  m[n - 1] = endSlope(h[n - 2], h[n - 3], d[n - 2], d[n - 3]);
  return m;
}
function endSlope(h0, h1, d0, d1) {
  let m = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
  if (Math.sign(m) !== Math.sign(d0)) m = 0;
  else if (Math.sign(d0) !== Math.sign(d1) && Math.abs(m) > 3 * Math.abs(d0)) m = 3 * d0;
  return m;
}
// Ease the very first/last tangent to 0 so every camera move starts and stops softly (no abrupt start).
export function makeCurve(keys, prop, { softEnds = true } = {}) {
  const ks = keys.filter((k) => k[prop] !== undefined).sort((a, b) => a.t - b.t);
  if (ks.length === 0) return () => undefined;
  const ts = ks.map((k) => k.t);
  const vs = ks.map((k) => k[prop]);
  const m = pchipSlopes(ts, vs);
  if (softEnds && ks.length > 1) {
    m[0] = 0;
    m[m.length - 1] = 0;
  }
  return (t) => {
    if (t <= ts[0]) return vs[0];
    if (t >= ts[ts.length - 1]) return vs[vs.length - 1];
    let i = 0;
    while (t > ts[i + 1]) i++;
    const h = ts[i + 1] - ts[i];
    const s = (t - ts[i]) / h;
    const s2 = s * s;
    const s3 = s2 * s;
    return (
      (2 * s3 - 3 * s2 + 1) * vs[i] +
      (s3 - 2 * s2 + s) * h * m[i] +
      (-2 * s3 + 3 * s2) * vs[i + 1] +
      (s3 - s2) * h * m[i + 1]
    );
  };
}

const CURSOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 24 24"><path d="M4 2 L4 19 L8.6 14.8 L11.6 21.6 L14.4 20.4 L11.4 13.8 L17.6 13.8 Z" fill="#0f1115" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;

const INIT_SCRIPT = (cursorSvg) => {
  const setup = () => {
    if (document.getElementById('__cur')) return;
    const st = document.createElement('style');
    st.textContent = `
      html{scrollbar-width:none;scroll-behavior:auto !important}
      ::-webkit-scrollbar{display:none}
      #__cur{position:fixed;left:0;top:0;width:34px;height:34px;z-index:2147483647;pointer-events:none;opacity:0;will-change:transform}
      #__rip{position:fixed;left:0;top:0;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:3px solid #E84142;z-index:2147483646;pointer-events:none;opacity:0}
      #__hl{position:absolute;z-index:2147483645;pointer-events:none;border:3px solid #E84142;border-radius:10px;box-shadow:0 0 0 6px rgba(232,65,66,.18);opacity:0}
    `;
    document.documentElement.appendChild(st);
    const c = document.createElement('div');
    c.id = '__cur';
    c.innerHTML = cursorSvg;
    document.documentElement.appendChild(c);
    const r = document.createElement('div');
    r.id = '__rip';
    document.documentElement.appendChild(r);
    const h = document.createElement('div');
    h.id = '__hl';
    document.documentElement.appendChild(h);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
  else setup();
  try {
    localStorage.setItem('missionpay_lang', 'en');
  } catch {}
};

export class Renderer {
  constructor({ baseUrl, dsf = 1.5, quality = 90 }) {
    this.baseUrl = baseUrl;
    this.dsf = dsf;
    this.quality = quality;
  }
  async open() {
    this.browser = await chromium.launch({ headless: true });
    this.ctx = await this.browser.newContext({
      viewport: { width: VW, height: VH },
      deviceScaleFactor: this.dsf,
      colorScheme: 'light',
    });
    await this.ctx.addInitScript(INIT_SCRIPT, CURSOR_SVG);
    this.page = await this.ctx.newPage();
    this.url = null;
  }
  async close() {
    await this.browser?.close();
  }
  async goto(url, force = false) {
    if (this.url === url && !force) return;
    const full = url.startsWith('http') || url.startsWith('file:') ? url : this.baseUrl + url;
    await this.page.goto(full, { waitUntil: 'networkidle', timeout: 45000 });
    await this.page.waitForTimeout(1200);
    this.url = url;
  }
  // Document-space box of an element: {x,y,w,h}
  async box(selOrLocator) {
    const loc = typeof selOrLocator === 'string' ? this.page.locator(selOrLocator).first() : selOrLocator;
    await loc.waitFor({ state: 'attached', timeout: 20000 });
    return loc.evaluate((e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height };
    });
  }

  // Render one scene.
  //  scene.cam    : keyframes {t, sy, cx, cy, z}  (sy = scroll Y in doc px; cx,cy = viewport centre of the camera; z = zoom)
  //  scene.cursor : keyframes {t, x, y} in DOCUMENT coordinates (cursor stays on its element while scrolling)
  //  scene.events : [{t, fn(page)}] run once when virtual time reaches t (clicks, fills ...)
  //  scene.clicks : [t,...] click ripple at the cursor position at those times (also does a real mouse click)
  async render(scene, outFile, { preview = false } = {}) {
    const { dur, cam, cursor = [], events = [], clicks = [] } = scene;
    const frames = Math.round(dur * FPS);
    const camCurves = {
      sy: makeCurve(cam, 'sy'),
      cx: makeCurve(cam, 'cx'),
      cy: makeCurve(cam, 'cy'),
      z: makeCurve(cam, 'z'),
    };
    const curX = makeCurve(cursor, 'x', { softEnds: true });
    const curY = makeCurve(cursor, 'y', { softEnds: true });
    const curT0 = cursor.length ? Math.min(...cursor.map((k) => k.t)) : Infinity;
    const pendingEvents = [...events].sort((a, b) => a.t - b.t);
    const clickTimes = [...clicks].sort((a, b) => a - b);

    const outW = preview ? 960 : VW;
    const outH = preview ? 540 : VH;
    const ff = spawn(
      'ffmpeg',
      [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
        '-vf', `scale=${outW}:${outH}:flags=lanczos`,
        '-c:v', 'libx264', '-preset', preview ? 'veryfast' : 'medium', '-crf', preview ? '24' : '15',
        '-pix_fmt', 'yuv420p', '-r', String(FPS), outFile,
      ],
      { stdio: ['pipe', 'inherit', 'inherit'] },
    );
    const ffDone = new Promise((res, rej) => {
      ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg exit ' + c))));
    });

    const page = this.page;
    // Page can keep scrolling state across scenes; reset to the first keyframe immediately.
    for (let f = 0; f < frames; f++) {
      const t = f / FPS;
      while (pendingEvents.length && pendingEvents[0].t <= t) {
        const ev = pendingEvents.shift();
        await ev.fn(page, this);
      }
      const sy = camCurves.sy(t) ?? 0;
      const z = camCurves.z(t) ?? 1;
      const cx = camCurves.cx(t) ?? VW / 2;
      const cy = camCurves.cy(t) ?? VH / 2;
      const cdx = cursor.length && t >= curT0 ? curX(t) : -100;
      const cdy = cursor.length && t >= curT0 ? curY(t) : -100;
      const vx = cdx;
      const vy = cdy - sy; // viewport coords of the cursor
      // ripple progress: 0..1 within 0.55 s after a click
      let rip = -1;
      for (const ct of clickTimes) if (t >= ct && t - ct < 0.55) rip = (t - ct) / 0.55;
      // real click at the moment of the click time
      const clickNow = clickTimes.find((ct) => f === Math.round(ct * FPS));

      await page.evaluate(
        ([sy, vx, vy, rip, show]) => {
          window.scrollTo(0, sy);
          const c = document.getElementById('__cur');
          if (c) {
            c.style.opacity = show ? '1' : '0';
            c.style.transform = `translate(${vx - 5}px,${vy - 3}px)`;
          }
          const r = document.getElementById('__rip');
          if (r) {
            if (rip >= 0) {
              r.style.opacity = String(1 - rip);
              r.style.transform = `translate(${vx}px,${vy}px) scale(${0.4 + rip * 1.1})`;
            } else r.style.opacity = '0';
          }
        },
        [sy, vx, vy, rip, cursor.length && t >= curT0],
      );
      if (cursor.length && t >= curT0) {
        await page.mouse.move(vx, vy);
        if (clickNow !== undefined) {
          await page.mouse.down();
          await page.mouse.up();
        }
      }

      const w = VW / z;
      const h = VH / z;
      const x = Math.min(Math.max(cx - w / 2, 0), VW - w);
      const y = Math.min(Math.max(cy - h / 2, 0), VH - h);
      const buf = await page.screenshot({
        type: 'jpeg',
        quality: preview ? 70 : this.quality,
        clip: { x, y, width: w, height: h },
        animations: 'allow',
        caret: 'hide',
      });
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    }
    ff.stdin.end();
    await ffDone;
  }
}
