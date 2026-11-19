// Generates PNG app icons (no dependencies): a red "eye" on dark.
import zlib from 'node:zlib';
import fs from 'node:fs';
const crcT = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = (b) => { let c = ~0; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; };
const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
function png(size, scale) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const sm = (d, e) => Math.min(1, Math.max(0, 0.5 - d / e));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const u = ((x + 0.5) / size - 0.5) / scale, v = ((y + 0.5) / size - 0.5) / scale;
      let c = [15, 17, 21];
      const mix = (col, a) => { c = c.map((p, i) => p + (col[i] - p) * a); };
      const eye = Math.abs(v) - 0.2 * Math.sqrt(Math.max(0, 1 - (u / 0.4) ** 2));
      if (Math.abs(u) < 0.4) mix([255, 255, 255], sm(eye, 0.012));
      mix([229, 25, 55], sm(Math.hypot(u, v) - 0.15, 0.012) * (Math.abs(u) < 0.4 ? 1 : 0));
      mix([15, 17, 21], sm(Math.hypot(u, v) - 0.065, 0.012));
      mix([255, 255, 255], sm(Math.hypot(u + 0.045, v + 0.045) - 0.02, 0.01));
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2]; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const out = 'web/icons/';
fs.writeFileSync(out + 'icon-192.png', png(192, 1.35));
fs.writeFileSync(out + 'icon-512.png', png(512, 1.35));
fs.writeFileSync(out + 'maskable-512.png', png(512, 1.0));
fs.writeFileSync(out + 'apple-touch-icon.png', png(180, 1.35));
console.log('icons written');
