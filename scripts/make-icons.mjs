/**
 * Generates the app icons.
 *
 * No image tooling in the build environment, so this rasterizes a few shapes
 * by hand and writes the PNGs directly. Run with `npm run icons`; the output
 * is committed, so this is not part of the normal build.
 */

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const OUT = path.resolve(process.cwd(), "public");

// --- PNG encoding -----------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

/** rgba is a Uint8ClampedArray of size w*h*4. */
function encodePNG(rgba, w, h) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- geometry ---------------------------------------------------------------

const hex = (s) => [
  parseInt(s.slice(1, 3), 16),
  parseInt(s.slice(3, 5), 16),
  parseInt(s.slice(5, 7), 16),
];

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/**
 * The mark: an ascending line with nodes, on a dark ground. It reads as
 * analytics at 40px, which is the size that actually matters on a home screen.
 */
function draw(size) {
  const SS = 4; // supersample factor for antialiasing
  const n = size * SS;
  const buf = new Uint8ClampedArray(size * size * 4);

  const BG = hex("#0f151d");
  const LINE = hex("#4da3ff");
  const BASE = hex("#26313f");
  const HIGH = hex("#3fbf7f");

  // Points in unit space, rising left to right with one dip.
  const pts = [
    [0.2, 0.66],
    [0.37, 0.5],
    [0.53, 0.58],
    [0.7, 0.34],
    [0.83, 0.24],
  ].map(([x, y]) => [x * n, y * n]);

  const lineW = n * 0.052;
  const dotR = n * 0.055;
  const baseY = n * 0.79;
  const baseW = n * 0.022;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let samples = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x * SS + sx + 0.5;
          const py = y * SS + sy + 0.5;

          let color = BG;

          // Baseline rule.
          if (Math.abs(py - baseY) <= baseW / 2 && px > n * 0.17 && px < n * 0.86) {
            color = BASE;
          }

          // Polyline.
          for (let i = 0; i < pts.length - 1; i++) {
            const d = distToSegment(px, py, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
            if (d <= lineW / 2) {
              color = LINE;
              break;
            }
          }

          // Nodes; the final one is the highlight.
          for (let i = 0; i < pts.length; i++) {
            const d = Math.hypot(px - pts[i][0], py - pts[i][1]);
            if (d <= dotR) color = i === pts.length - 1 ? HIGH : LINE;
          }

          r += color[0];
          g += color[1];
          b += color[2];
          samples++;
        }
      }

      const o = (y * size + x) * 4;
      buf[o] = r / samples;
      buf[o + 1] = g / samples;
      buf[o + 2] = b / samples;
      buf[o + 3] = 255;
    }
  }

  return encodePNG(buf, size, size);
}

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="22" fill="#0f151d"/>
  <line x1="17" y1="79" x2="86" y2="79" stroke="#26313f" stroke-width="2.2" stroke-linecap="round"/>
  <polyline points="20,66 37,50 53,58 70,34 83,24" fill="none" stroke="#4da3ff"
    stroke-width="5.2" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="20" cy="66" r="5.5" fill="#4da3ff"/>
  <circle cx="37" cy="50" r="5.5" fill="#4da3ff"/>
  <circle cx="53" cy="58" r="5.5" fill="#4da3ff"/>
  <circle cx="70" cy="34" r="5.5" fill="#4da3ff"/>
  <circle cx="83" cy="24" r="5.5" fill="#3fbf7f"/>
</svg>
`;

mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, "icon.svg"), SVG);
for (const size of [180, 192, 512]) {
  writeFileSync(path.join(OUT, `icon-${size}.png`), draw(size));
  console.log(`wrote public/icon-${size}.png`);
}
console.log("wrote public/icon.svg");
