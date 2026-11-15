// Makes an uploaded CV photo small enough to live inside every CV: a phone picture of several megabytes would
// make each PDF that large, and many application forms refuse big files. The browser Huntboard already uses for
// PDFs does the work (its canvas), so no image library is needed. If anything fails the original file is kept.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { dumpDom } = require('./pdf');

const MAX_SIDE = 900; // px: plenty for a 3 × 4 cm photo at print quality
const KEEP_BELOW = 300 * 1024; // already small: leave it alone
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };

function shrink(data, ext) {
  const mime = MIME[String(ext || '').toLowerCase()];
  if (!mime || !Buffer.isBuffer(data) || data.length <= KEEP_BELOW) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-photo-'));
  const page = path.join(dir, 'photo.html');
  try {
    fs.writeFileSync(page, `<!doctype html><meta charset="utf-8"><body><script>
const img = new Image();
const done = (t) => { document.body.innerHTML = '<pre id="out">' + t + '</pre>'; };
img.onerror = () => done('ERROR');
img.onload = () => {
  const k = Math.min(1, ${MAX_SIDE} / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * k);
  c.height = Math.round(img.naturalHeight * k);
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, c.width, c.height);
  done(c.toDataURL('image/jpeg', 0.9));
};
img.src = 'data:${mime};base64,${data.toString('base64')}';
</script></body>`);
    const m = dumpDom(page).match(/<pre id="out">data:image\/jpeg;base64,([A-Za-z0-9+/=]+)<\/pre>/);
    if (!m) return null;
    const out = Buffer.from(m[1], 'base64');
    return out.length > 1000 && out.length < data.length ? { data: out, ext: '.jpg' } : null;
  } catch {
    return null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---- the photo inside the user's CV ------------------------------------------------------------------
// Many CVs (above all in Germany, Austria, Switzerland, Italy) carry the user's photo. fromCv() takes it out of the
// uploaded PDF or Word file, so the user does not have to find the picture again. The best candidate is a portrait
// or square picture of at least 80 × 80 pixels (logos, icons and wide banners are skipped), the largest one wins.

const zlib = require('zlib');

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

// Raw pixels (1 = grey, 3 = RGB, 4 = RGBA per pixel) → PNG file bytes.
function encodePng(pixels, width, height, channels) {
  const type = { 1: 0, 3: 2, 4: 6 }[channels];
  if (type == null) throw new Error(`Cannot encode ${channels} channels`);
  const row = width * channels;
  const raw = Buffer.alloc((row + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (row + 1)] = 0;
    Buffer.from(pixels.buffer, pixels.byteOffset + y * row, row).copy(raw, y * (row + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = type;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// Width and height from the header of a PNG, JPEG or GIF file.
function imageSize(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24) return null;
  if (buf.readUInt32BE(0) === 0x89504e47) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), ext: '.png' };
  if (buf.slice(0, 3).toString('ascii') === 'GIF') return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8), ext: '.gif' };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5), ext: '.jpg' };
      i += 2 + len;
    }
  }
  return null;
}

// Is this picture likely the user's photo? Returns a score (bigger is better) or 0.
function photoScore(width, height) {
  if (!width || !height || width < 80 || height < 80) return 0;
  const r = height / width;
  if (r < 0.85 || r > 1.9) return 0; // logos, lines and banners are wide; a photo is portrait or square
  return width * height * (r >= 1.1 && r <= 1.6 ? 1.5 : 1); // passport-like 3:4 / 4:5 wins a tie
}

// The pictures on one PDF page as raw pixels. (pdf.js hands an image over only once it is decoded, so each one is
// awaited with a callback; unpdf's own extractImages asks too early.)
async function pageImages(pdf, n, OPS) {
  const page = await pdf.getPage(n);
  const ops = await page.getOperatorList();
  const out = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    if (ops.fnArray[i] !== OPS.paintImageXObject) continue;
    const id = ops.argsArray[i][0];
    const store = String(id).startsWith('g_') ? page.commonObjs : page.objs;
    const img = await Promise.race([new Promise((res) => store.get(id, res)), new Promise((res) => setTimeout(() => res(null), 5000))]);
    if (!img || !img.data || !img.width || !img.height) continue;
    const channels = img.data.length / (img.width * img.height);
    if ([1, 3, 4].includes(channels)) out.push({ data: img.data, width: img.width, height: img.height, channels });
  }
  return out;
}

async function pdfImages(data) {
  const { getDocumentProxy, getResolvedPDFJS } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const { OPS } = await getResolvedPDFJS();
  const out = [];
  for (let page = 1; page <= Math.min(2, pdf.numPages); page++) {
    let imgs = [];
    try {
      imgs = await pageImages(pdf, page, OPS);
    } catch {
      continue;
    }
    for (const im of imgs) {
      const score = photoScore(im.width, im.height);
      if (score) out.push({ score, make: () => ({ data: encodePng(im.data, im.width, im.height, im.channels), ext: '.png' }) });
    }
  }
  return out;
}

async function docxImages(file) {
  const mammoth = require('mammoth');
  const found = [];
  await mammoth.convertToHtml({ path: file }, {
    convertImage: mammoth.images.imgElement(async (image) => {
      try {
        const buf = await image.readAsBuffer();
        const size = imageSize(buf);
        const score = size ? photoScore(size.width, size.height) : 0;
        if (score) found.push({ score, make: () => ({ data: buf, ext: size.ext }) });
      } catch { /* an image Word cannot give us */ }
      return { src: '' };
    }),
  });
  return found;
}

// The photo in a CV file (PDF or DOCX) → { data, ext } ready to save as the CV photo, or null.
async function fromCv(file) {
  const ext = path.extname(file).toLowerCase();
  let candidates = [];
  if (ext === '.pdf') candidates = await pdfImages(fs.readFileSync(file));
  else if (ext === '.docx') candidates = await docxImages(file);
  else return null;
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0].make();
  return shrink(best.data, best.ext) || best;
}

module.exports = { shrink, MIME, fromCv, encodePng, imageSize, photoScore };
