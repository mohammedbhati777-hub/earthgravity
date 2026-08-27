/* Procedural planet textures — generated on canvas, no network assets.
   Fractal value noise produces continents, clouds, craters and gas bands. */
import * as THREE from "three";

function hash(x: number, y: number): number {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}
function smooth(t: number) { return t * t * (3 - 2 * t); }

/** periodic-in-x 2D value noise */
function noise2(x: number, y: number, px: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const x0 = ((xi % px) + px) % px, x1 = (x0 + 1) % px;
  const a = hash(x0, yi), b = hash(x1, yi), c = hash(x0, yi + 1), d = hash(x1, yi + 1);
  const u = smooth(xf), v = smooth(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, y: number, px: number, oct = 5): number {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) {
    s += amp * noise2(x * f, y * f, Math.max(1, Math.round(px * f)));
    amp *= 0.5; f *= 2;
  }
  return s;
}

const cache = new Map<string, THREE.CanvasTexture>();
const W = 1024, H = 512;

function makeCanvas(key: string, draw: (ctx: CanvasRenderingContext2D, img: ImageData) => void): THREE.CanvasTexture {
  if (cache.has(key)) return cache.get(key)!;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(W, H);
  draw(ctx, img);
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  cache.set(key, tex);
  return tex;
}

const px = (img: ImageData, i: number, r: number, g: number, b: number, a = 255) => {
  img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = a;
};

function earthDay(): THREE.CanvasTexture {
  return makeCanvas("earth-day", (_ctx, img) => {
    for (let y = 0; y < H; y++) {
      const lat = (0.5 - y / H) * Math.PI;
      const absLat = Math.abs(lat);
      for (let x = 0; x < W; x++) {
        const u = (x / W) * 8, v = (y / H) * 4;
        const e = fbm(u + 3.7, v + 1.2, 8, 6);
        const det = fbm(u * 3 + 9.1, v * 3 + 4.4, 24, 4) * 0.18;
        const h = e + det;
        const i = (y * W + x) * 4;
        const land = h > 0.615;
        const ice = absLat > 1.18 || (absLat > 1.02 && h > 0.58);
        if (ice) { px(img, i, 225, 235, 244); continue; }
        if (!land) {
          const depth = Math.min(1, (0.615 - h) * 6);
          const r = 8 + 26 * (1 - depth), g = 34 + 66 * (1 - depth), b = 74 + 96 * (1 - depth);
          px(img, i, r, g, b);
        } else {
          const m = fbm(u * 2 + 21, v * 2 + 7, 16, 4);
          const dryBand = Math.exp(-((absLat - 0.42) ** 2) / 0.05);
          const gr = 0.35 + m * 0.5;
          const r = 34 + 120 * dryBand + 60 * m * (1 - dryBand);
          const g = 84 * gr + 90 * (1 - dryBand) + 40 * dryBand;
          const b = 34 + 30 * m;
          const coast = h < 0.63 ? 0.65 : 1;
          px(img, i, r * coast + 20, g * coast + 14, b * coast + 10);
        }
      }
    }
  });
}

function earthNight(): THREE.CanvasTexture {
  return makeCanvas("earth-night", (_ctx, img) => {
    for (let y = 0; y < H; y++) {
      const lat = (0.5 - y / H) * Math.PI;
      for (let x = 0; x < W; x++) {
        const u = (x / W) * 8, v = (y / H) * 4;
        const e = fbm(u + 3.7, v + 1.2, 8, 6) + fbm(u * 3 + 9.1, v * 3 + 4.4, 24, 4) * 0.18;
        const land = e > 0.615 && Math.abs(lat) < 1.12;
        const i = (y * W + x) * 4;
        if (!land) { px(img, i, 2, 4, 9); continue; }
        const c1 = fbm(u * 5 + 40, v * 5 + 17, 40, 4);
        const c2 = fbm(u * 12 + 61, v * 12 + 33, 96, 3);
        const city = c1 > 0.6 && c2 > 0.62 ? Math.min(1, (c1 - 0.6) * 9) * Math.min(1, (c2 - 0.62) * 8) : 0;
        const mid = Math.cos(lat * 1.15);
        const L = city * (0.35 + 0.65 * mid);
        px(img, i, 255 * L, 190 * L, 110 * L);
      }
    }
  });
}

function earthClouds(): THREE.CanvasTexture {
  return makeCanvas("earth-clouds", (_ctx, img) => {
    for (let y = 0; y < H; y++) {
      const lat = (0.5 - y / H) * Math.PI;
      for (let x = 0; x < W; x++) {
        const u = (x / W) * 6, v = (y / H) * 3;
        const band = Math.sin(lat * 3.1) * 0.5;
        const c = fbm(u + band + 71, v + 29, 6, 5);
        const a = Math.max(0, (c - 0.56) * 3.2);
        const i = (y * W + x) * 4;
        px(img, i, 255, 255, 255, Math.min(255, a * 255));
      }
    }
  });
}

function moonTex(): THREE.CanvasTexture {
  return makeCanvas("moon", (ctx, img) => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const u = (x / W) * 8, v = (y / H) * 4;
      const n = fbm(u + 5, v + 5, 8, 5);
      const mare = fbm(u * 0.7 + 31, v * 0.7 + 12, 6, 3) > 0.6 ? 0.72 : 1;
      const g = (120 + n * 110) * mare;
      px(img, (y * W + x) * 4, g, g * 0.98, g * 0.95);
    }
    ctx.putImageData(img, 0, 0);
    for (let k = 0; k < 240; k++) {
      const cx = Math.random() * W, cy = Math.random() * H, r = 1 + Math.random() * 9;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7);
      ctx.fillStyle = `rgba(40,42,48,${0.12 + Math.random() * 0.2})`; ctx.fill();
      ctx.beginPath(); ctx.arc(cx - r * 0.2, cy - r * 0.2, r * 0.75, 0, 7);
      ctx.fillStyle = `rgba(190,192,200,${0.06 + Math.random() * 0.1})`; ctx.fill();
    }
  });
}

function marsTex(): THREE.CanvasTexture {
  return makeCanvas("mars", (_ctx, img) => {
    for (let y = 0; y < H; y++) {
      const lat = Math.abs((0.5 - y / H) * Math.PI);
      for (let x = 0; x < W; x++) {
        const u = (x / W) * 8, v = (y / H) * 4;
        const n = fbm(u + 13, v + 8, 8, 5);
        const dark = fbm(u * 0.8 + 50, v * 0.8 + 40, 6, 4) > 0.62 ? 0.62 : 1;
        const cap = lat > 1.28 ? 1 : 0;
        const i = (y * W + x) * 4;
        if (cap) { px(img, i, 232, 224, 214); continue; }
        px(img, i, (150 + n * 80) * dark + 30, (76 + n * 46) * dark + 14, (44 + n * 26) * dark + 8);
      }
    }
  });
}

function jupiterTex(): THREE.CanvasTexture {
  return makeCanvas("jupiter", (_ctx, img) => {
    for (let y = 0; y < H; y++) {
      const t = y / H;
      for (let x = 0; x < W; x++) {
        const u = (x / W) * 10;
        const turb = fbm(u + 3, t * 26, 10, 4) * 0.16;
        const band = Math.sin((t + turb) * 42) * 0.5 + 0.5;
        const n = fbm(u * 2 + 17, t * 40, 20, 4);
        const mixv = band * 0.7 + n * 0.3;
        const i = (y * W + x) * 4;
        px(img, i, 176 + mixv * 62, 140 + mixv * 66, 100 + mixv * 52);
        // great red spot
        const dx = (x / W - 0.3) * 2.4, dy = (t - 0.62) * 5.4;
        if (dx * dx + dy * dy < 0.012) { px(img, i, 202, 102, 74); }
      }
    }
  });
}

export function getTexture(body: string, kind: "day" | "night" | "clouds"): THREE.CanvasTexture {
  if (body === "earth") {
    if (kind === "night") return earthNight();
    if (kind === "clouds") return earthClouds();
    return earthDay();
  }
  if (body === "moon") return moonTex();
  if (body === "mars") return marsTex();
  return jupiterTex();
}
