import { crc32, deflateSync } from "node:zlib";

const SIZE = 180;
const BG: [number, number, number] = [11, 15, 26];
const RAIL: [number, number, number] = [58, 66, 90];
const KNOBS: { y: number; x: number; color: [number, number, number] }[] = [
  { y: 52, x: 118, color: [245, 165, 36] },
  { y: 90, x: 62, color: [109, 124, 255] },
  { y: 128, x: 104, color: [62, 207, 142] },
];

function pixel(x: number, y: number): [number, number, number] {
  for (const k of KNOBS) {
    if ((x - k.x) ** 2 + (y - k.y) ** 2 <= 15 * 15) return k.color;
    if (Math.abs(y - k.y) <= 3 && x >= 34 && x <= 146) return RAIL;
  }
  return BG;
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
