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

module.exports = { shrink, MIME };
