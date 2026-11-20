// Static-frame scene renderer for the MissionPay demo (r21).
//
// Principles (the owner asked for a fixed, clean frame; r20's continuous pan/zoom looked laggy):
//   * Every scene is a FIXED 1920x950 framing of the live page (the caption band is added later below it).
//   * The page is screenshotted at 2x device pixels ONLY when something on it changes (cursor move, typing,
//     click result, callout fade). Unchanged frames reuse the identical screenshot => pixel-exact stillness.
//   * Zoom is used rarely: a single eased move (0.5-0.8 s) to an emphasis point, then it holds. The zoom is a
//     sub-pixel-exact Lanczos resize of the 2x screenshot (Pillow box resize), so there is no integer rounding jump.
//   * Output: raw frames piped to ffmpeg at constant 30 fps, lossless intermediate; one lossy encode at the end.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FPS = 30;
export const VW = 1920;
export const VH = 950; // page area; the 130 px caption band is composited below it by assemble-video.py
export const DSF = 2;
const HERE = path.dirname(fileURLToPath(import.meta.url));

// monotone cubic Hermite (PCHIP): flat segments stay exactly flat, moves ease in and out (C1, no overshoot)
function pchipSlopes(ts, vs) {
  const n = ts.length;
  if (n === 1) return [0];
  const d = [];
  const h = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(ts[i + 1] - ts[i]);
    d.push((vs[i + 1] - vs[i]) / h[i]);
  }
  if (n === 2) return [0, 0];
  const m = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0;
    else {
      const w1 = 2 * h[i] + h[i - 1];
      const w2 = h[i] + 2 * h[i - 1];
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
    }
  }
  return m; // end slopes stay 0: soft start/stop
}
export function makeCurve(keys, prop) {
  const ks = keys.filter((k) => k[prop] !== undefined).sort((a, b) => a.t - b.t);
  if (ks.length === 0) return () => undefined;
  const ts = ks.map((k) => k.t);
  const vs = ks.map((k) => k[prop]);
  const m = pchipSlopes(ts, vs);
  return (t) => {
    if (t <= ts[0]) return vs[0];
    if (t >= ts[ts.length - 1]) return vs[vs.length - 1];
    let i = 0;
    while (t > ts[i + 1]) i++;
    const h = ts[i + 1] - ts[i];
    if (vs[i] === vs[i + 1]) return vs[i];
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

const CURSOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="38" height="38" viewBox="0 0 24 24"><path d="M4 2 L4 19 L8.6 14.8 L11.6 21.6 L14.4 20.4 L11.4 13.8 L17.6 13.8 Z" fill="#0f1115" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;

const INIT_SCRIPT = (cursorSvg) => {
  const setup = () => {
    if (document.getElementById('__cur')) return;
    const st = document.createElement('style');
    st.textContent = `
      html{scrollbar-width:none;scroll-behavior:auto !important}
      ::-webkit-scrollbar{display:none}
      #__cur{position:fixed;left:0;top:0;width:38px;height:38px;z-index:2147483647;pointer-events:none;opacity:0}
      #__rip{position:fixed;left:0;top:0;width:48px;height:48px;margin:-24px 0 0 -24px;border-radius:50%;border:3px solid #E84142;z-index:2147483646;pointer-events:none;opacity:0}
      #__hl{position:absolute;left:0;top:0;z-index:2147483645;pointer-events:none;border:4px solid #E84142;border-radius:10px;box-shadow:0 0 0 7px rgba(232,65,66,.20);opacity:0}
      #__tag{position:absolute;left:0;top:0;z-index:2147483645;pointer-events:none;background:#E84142;color:#fff;font:700 22px/1.2 "Segoe UI",Arial,sans-serif;padding:7px 14px;border-radius:8px;white-space:nowrap;opacity:0;box-shadow:0 4px 14px rgba(15,17,21,.25)}
    `;
    document.documentElement.appendChild(st);
    const mk = (id, html) => {
      const e = document.createElement('div');
      e.id = id;
      if (html) e.innerHTML = html;
      document.documentElement.appendChild(e);
    };
    mk('__cur', cursorSvg);
    mk('__rip');
    mk('__hl');
    mk('__tag');
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
  else setup();
  try {
    localStorage.setItem('missionpay_lang', 'en');
  } catch {}
};

export class Renderer {
  constructor({ baseUrl, workDir }) {
    this.baseUrl = baseUrl;
    this.workDir = workDir;
  }
  async open() {
    this.browser = await chromium.launch({ headless: true });
    this.ctx = await this.browser.newContext({
      viewport: { width: VW, height: VH },
      deviceScaleFactor: DSF,
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
  async box(selOrLocator) {
    const loc = typeof selOrLocator === 'string' ? this.page.locator(selOrLocator).first() : selOrLocator;
    await loc.waitFor({ state: 'attached', timeout: 20000 });
    return loc.evaluate((e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height };
    });
  }
  async docH() {
    return this.page.evaluate(() => document.documentElement.scrollHeight);
  }

  // scene = {
  //   dur,                      seconds
  //   sy,                       fixed scroll position (doc px) for the whole scene
  //   zoom: [{t, z, cx, cy}],   optional, viewport coords of the zoom centre; keep constant after the move
  //   cursor: [{t,x,y}],        DOCUMENT coords, smooth path
  //   clicks: [t],              click ripple + real click at the cursor
  //   events: [{t, fn}],        typing, etc.
  //   hl: [{t0, t1, box, label}]  red callout frame (doc coords) + optional label tag, fades 0.25 s
  // }
  async render(scene, name) {
    const { dur, sy = 0, zoom = [], cursor = [], clicks = [], events = [], hl = [] } = scene;
    const frames = Math.round(dur * FPS);
    const shotDir = path.join(this.workDir, name + '_shots');
    fs.rmSync(shotDir, { recursive: true, force: true });
    fs.mkdirSync(shotDir, { recursive: true });
    const zKeys = zoom.length ? zoom : [{ t: 0, z: 1, cx: VW / 2, cy: VH / 2 }];
    const zc = {
      z: makeCurve(zKeys, 'z'),
      cx: makeCurve(zKeys, 'cx'),
      cy: makeCurve(zKeys, 'cy'),
    };
    const curX = makeCurve(cursor, 'x');
    const curY = makeCurve(cursor, 'y');
    const curT0 = cursor.length ? Math.min(...cursor.map((k) => k.t)) : Infinity;
    const pending = [...events].sort((a, b) => a.t - b.t);
    const clickTimes = [...clicks].sort((a, b) => a - b);
    const page = this.page;

    await page.evaluate((sy) => window.scrollTo(0, sy), sy);
    const manifest = { w: VW, h: VH, dsf: DSF, fps: FPS, frames: [] };
    let shots = 0;
    let lastKey = '';
    let lastShot = -1;
    let settleUntil = 0.5; // capture every frame while anything may still be changing
    const clickDone = new Set();

    for (let f = 0; f < frames; f++) {
      const t = f / FPS;
      let touched = false;
      while (pending.length && pending[0].t <= t) {
        const ev = pending.shift();
        await ev.fn(page, this);
        touched = true;
        settleUntil = Math.max(settleUntil, t + 1.6);
      }
      // cursor
      const show = cursor.length > 0 && t >= curT0;
      const cx = show ? curX(t) : -200;
      const cy = show ? curY(t) - sy : -200;
      // click ripple (0.5 s)
      let rip = -1;
      for (const ct of clickTimes) if (t >= ct && t - ct < 0.5) rip = (t - ct) / 0.5;
      for (const ct of clickTimes) {
        if (!clickDone.has(ct) && f >= Math.round(ct * FPS)) {
          clickDone.add(ct);
          if (show) {
            await page.mouse.move(cx, cy);
            await page.mouse.down();
            await page.mouse.up();
          }
          touched = true;
          settleUntil = Math.max(settleUntil, t + 2.2);
        }
      }
      if (show) await page.mouse.move(cx, cy);
      // callouts (fade in/out 0.25 s)
      let hlState = null;
      for (const h of hl) {
        if (t >= h.t0 && t <= h.t1) {
          const a = Math.min(1, (t - h.t0) / 0.25, (h.t1 - t) / 0.25);
          hlState = { box: h.box, label: h.label || '', tagAt: h.tagAt || null, a: Math.round(a * 20) / 20 };
        }
      }
      const key = JSON.stringify([sy, show, Math.round(cx * 2), Math.round(cy * 2), Math.round(rip * 20), hlState]);
      const mustShoot = f === 0 || key !== lastKey || touched || t < settleUntil;
      if (mustShoot) {
        await page.evaluate(
          ([sy, cx, cy, rip, show, hlState]) => {
            window.scrollTo(0, sy);
            const c = document.getElementById('__cur');
            if (c) {
              c.style.opacity = show ? '1' : '0';
              c.style.transform = `translate(${cx - 5}px,${cy - 3}px)`;
            }
            const r = document.getElementById('__rip');
            if (r) {
              if (rip >= 0) {
                r.style.opacity = String(1 - rip);
                r.style.transform = `translate(${cx}px,${cy}px) scale(${0.4 + rip * 1.1})`;
              } else r.style.opacity = '0';
            }
            const hl = document.getElementById('__hl');
            const tag = document.getElementById('__tag');
            if (hl && tag) {
              if (hlState) {
                const b = hlState.box;
                hl.style.opacity = String(hlState.a);
                hl.style.left = b.x - 8 + 'px';
                hl.style.top = b.y - 8 + 'px';
                hl.style.width = b.w + 16 - 8 + 'px';
                hl.style.height = b.h + 16 - 8 + 'px';
                if (hlState.label) {
                  tag.textContent = hlState.label;
                  tag.style.opacity = String(hlState.a);
                  const tp = hlState.tagAt;
                  tag.style.left = (tp ? tp.x : b.x - 8) + 'px';
                  tag.style.top = (tp ? tp.y : b.y - 8 - 44) + 'px';
                } else tag.style.opacity = '0';
              } else {
                hl.style.opacity = '0';
                tag.style.opacity = '0';
              }
            }
          },
          [sy, cx, cy, rip, show, hlState],
        );
        const buf = await page.screenshot({ type: 'jpeg', quality: 95, animations: 'allow', caret: 'hide' });
        fs.writeFileSync(path.join(shotDir, `${shots}.jpg`), buf);
        lastShot = shots++;
        lastKey = key;
      }
      // camera box in CSS viewport px
      const z = zc.z(t) ?? 1;
      const w = VW / z;
      const h = VH / z;
      const x0 = Math.min(Math.max((zc.cx(t) ?? VW / 2) - w / 2, 0), VW - w);
      const y0 = Math.min(Math.max((zc.cy(t) ?? VH / 2) - h / 2, 0), VH - h);
      manifest.frames.push([lastShot, +x0.toFixed(4), +y0.toFixed(4), +w.toFixed(4), +h.toFixed(4)]);
    }
    manifest.shotDir = shotDir;
    const mf = path.join(this.workDir, name + '.manifest.json');
    fs.writeFileSync(mf, JSON.stringify(manifest));
    return { manifest: mf, shots };
  }
}

export function composeToVideo(manifestFile, outFile) {
  return new Promise((resolve, reject) => {
    const p = spawn('python', ['-I', path.join(HERE, 'compose-frames.py'), manifestFile, outFile], { stdio: 'inherit' });
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error('compose-frames exit ' + c))));
  });
}
