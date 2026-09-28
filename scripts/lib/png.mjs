// png.mjs — 最小 PNG 编解码器（零依赖）：只为视觉回归的像素比对服务。
// 从 brandui 移植。支持 bitDepth 8 的 colorType 0/2/4/6；输出统一为 RGBA8。
import { inflateSync, deflateSync } from 'node:zlib';

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];

const CRC_TABLE = (function () {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

export function decodePng(buf) {
  for (let i = 0; i < 8; i++) if (buf[i] !== SIG[i]) throw new Error('不是 PNG 文件');
  let pos = 8; let width = 0; let height = 0; let bitDepth = 0; let colorType = 0; const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos); const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; if (data[12] !== 0) throw new Error('不支持交错 PNG'); }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error('仅支持 bitDepth 8，实际 ' + bitDepth);
  const ch = CHANNELS[colorType];
  if (!ch) throw new Error('不支持的 colorType ' + colorType);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const cur = Buffer.alloc(height * stride);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const ft = raw[rp++];
    const rowStart = y * stride; const prevStart = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[rp + x];
      const a = x >= ch ? cur[rowStart + x - ch] : 0;
      const b = y > 0 ? cur[prevStart + x] : 0;
      const c = x >= ch && y > 0 ? cur[prevStart + x - ch] : 0;
      let out;
      if (ft === 0) out = v;
      else if (ft === 1) out = v + a;
      else if (ft === 2) out = v + b;
      else if (ft === 3) out = v + ((a + b) >> 1);
      else if (ft === 4) out = v + paeth(a, b, c);
      else throw new Error('未知过滤器 ' + ft);
      cur[rowStart + x] = out & 0xff;
    }
    rp += stride;
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * ch; const d = i * 4;
    if (colorType === 6) { rgba[d] = cur[s]; rgba[d + 1] = cur[s + 1]; rgba[d + 2] = cur[s + 2]; rgba[d + 3] = cur[s + 3]; }
    else if (colorType === 2) { rgba[d] = cur[s]; rgba[d + 1] = cur[s + 1]; rgba[d + 2] = cur[s + 2]; rgba[d + 3] = 255; }
    else if (colorType === 4) { rgba[d] = cur[s]; rgba[d + 1] = cur[s]; rgba[d + 2] = cur[s]; rgba[d + 3] = cur[s + 1]; }
    else { rgba[d] = cur[s]; rgba[d + 1] = cur[s]; rgba[d + 2] = cur[s]; rgba[d + 3] = 255; }
  }
  return { width, height, data: rgba };
}

function paeth(a, b, c) {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

export function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([Buffer.from(SIG), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// pixelmatch 同款 YIQ 感知色差：返回带符号的 delta，绝对值越大差异越明显。
export function colorDelta(r1, g1, b1, a1, r2, g2, b2, a2) {
  if (a1 === a2 && r1 === r2 && g1 === g2 && b1 === b2) return 0;
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2, da = a1 - a2;
  const y = dr * 0.29889531 + dg * 0.58662247 + db * 0.11448223;
  const i = dr * 0.59597799 - dg * 0.27417610 - db * 0.32180189;
  const q = dr * 0.21147017 - dg * 0.52261711 + db * 0.31114694;
  const delta = 0.5053 * y * y + 0.299 * i * i + 0.1957 * q * q;
  if (da !== 0) {
    const ay = 0.29889531 * 255, ai = 0.59597799 * 255, aq = 0.21147017 * 255;
    const ad = 0.5053 * ay * ay + 0.299 * ai * ai + 0.1957 * aq * aq;
    return da < 0 ? delta + ad : delta - ad;
  }
  return y > 0 ? -delta : delta;
}

export function ssim8x8(a, b, width, height) {
  const C1 = (0.01 * 255) * (0.01 * 255); const C2 = (0.03 * 255) * (0.03 * 255);
  const gray = function (img) {
    const g = new Float64Array(width * height);
    for (let i = 0; i < width * height; i++) { const d = i * 4; g[i] = 0.299 * img[d] + 0.587 * img[d + 1] + 0.114 * img[d + 2]; }
    return g;
  };
  const ga = gray(a); const gb = gray(b);
  let total = 0; let blocks = 0;
  for (let by = 0; by + 8 <= height; by += 8) {
    for (let bx = 0; bx + 8 <= width; bx += 8) {
      let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0; const n = 64;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const i = (by + y) * width + (bx + x); const va = ga[i]; const vb = gb[i];
        sa += va; sb += vb; saa += va * va; sbb += vb * vb; sab += va * vb;
      }
      const ma = sa / n, mb = sb / n;
      const va = saa / n - ma * ma, vb = sbb / n - mb * mb;
      const cov = sab / n - ma * mb;
      total += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
      blocks++;
    }
  }
  return blocks ? total / blocks : 1;
}
