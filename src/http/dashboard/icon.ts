import { crc32, deflateSync } from "node:zlib";

const SIZE = 180;
const SS = 3;
type Rgb = [number, number, number];
const BG: Rgb = [10, 46, 36];
const TRACE: Rgb = [28, 90, 69];
const GOLD: Rgb = [188, 133, 38];
const GOLD_HI: Rgb = [226, 180, 92];
const BODY: Rgb = [20, 24, 22];
const BODY_EDGE: Rgb = [48, 56, 51];
const INDIGO: Rgb = [129, 140, 248];
const BODY_MIN = 46;
const BODY_MAX = 134;
const PIN_AT = [60, 75, 90, 105, 120];

const CABLE: [number, number][] = Array.from({ length: 49 }, (_, i) => {
  const t = i / 48;
  const u = 1 - t;
  const [x0, y0, x1, y1, x2, y2, x3, y3] = [64, 112, 100, 112, 80, 68, 116, 68] as const;
  return [
    u ** 3 * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t ** 3 * x3,
    u ** 3 * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t ** 3 * y3,
  ];
});
const JACKS: [number, number][] = [CABLE[0] as [number, number], CABLE[48] as [number, number]];

function cableDistance(x: number, y: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < CABLE.length - 1; i++) {
    const [ax, ay] = CABLE[i] as [number, number];
    const [bx, by] = CABLE[i + 1] as [number, number];
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)));
  }
  return best;
}

function inRoundedBody(x: number, y: number, inset: number): boolean {
  const r = 9 - inset;
  const lo = BODY_MIN + inset;
  const hi = BODY_MAX - inset;
  if (x < lo || x > hi || y < lo || y > hi) return false;
  const cx = Math.max(lo + r, Math.min(x, hi - r));
  const cy = Math.max(lo + r, Math.min(y, hi - r));
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function sample(x: number, y: number): Rgb {
  for (const [jx, jy] of JACKS) {
    const d = Math.hypot(x - jx, y - jy);
    if (d <= 4) return BODY;
    if (d <= 9.5) return INDIGO;
  }
  if (cableDistance(x, y) <= 2.8) return INDIGO;
  if (Math.hypot(x - 54, y - 54) <= 2.5) return BODY_EDGE;
  if (inRoundedBody(x, y, 1.5)) return BODY;
  if (inRoundedBody(x, y, 0)) return BODY_EDGE;
  for (const p of PIN_AT) {
    const inX = Math.abs(x - p) <= 3.2 && (y < BODY_MIN + 2 || y > BODY_MAX - 2);
    const inY = Math.abs(y - p) <= 3.2 && (x < BODY_MIN + 2 || x > BODY_MAX - 2);
    if (inX || inY) {
      const tip = y < 40 || y > 140 || x < 40 || x > 140;
      if (y >= 34 && y <= 146 && x >= 34 && x <= 146) return tip ? GOLD_HI : GOLD;
      return TRACE;
    }
  }
  for (const p of PIN_AT) {
    for (const [px, py] of [
      [p, 20],
      [p, 160],
      [20, p],
      [160, p],
    ] as const) {
      const d = Math.hypot(x - px, y - py);
      if (d <= 4.5 && d >= 2) return GOLD;
    }
  }
  return BG;
}

function pixel(x: number, y: number): Rgb {
  const sum: Rgb = [0, 0, 0];
  for (let sy = 0; sy < SS; sy++) {
    for (let sx = 0; sx < SS; sx++) {
      const c = sample(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS);
      sum[0] += c[0];
      sum[1] += c[1];
      sum[2] += c[2];
    }
  }
  const n = SS * SS;
  return [Math.round(sum[0] / n), Math.round(sum[1] / n), Math.round(sum[2] / n)];
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

function png(): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const raw = Buffer.alloc((SIZE * 3 + 1) * SIZE);
  for (let y = 0; y < SIZE; y++) {
    const row = y * (SIZE * 3 + 1);
    for (let x = 0; x < SIZE; x++) raw.set(pixel(x, y), row + 1 + x * 3);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export const ICON_DATA_URI = `data:image/png;base64,${png().toString("base64")}`;
