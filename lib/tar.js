// A small reader for .tar.gz archives (the "Download" archive GitHub makes of a branch), so an update of a
// zip/tarball install needs no extra program or package. Supports plain ustar entries, GNU long names and
// pax headers (path=…), which is what GitHub writes.

const zlib = require('zlib');

const str = (buf, start, len) => {
  const s = buf.slice(start, start + len);
  const end = s.indexOf(0);
  return (end >= 0 ? s.slice(0, end) : s).toString('utf8');
};
const octal = (buf, start, len) => parseInt(str(buf, start, len).trim() || '0', 8) || 0;

function paxPath(data) {
  let out = null;
  let i = 0;
  const text = data.toString('utf8');
  while (i < text.length) {
    const sp = text.indexOf(' ', i);
    if (sp < 0) break;
    const len = Number(text.slice(i, sp));
    if (!len) break;
    const rec = text.slice(sp + 1, i + len - 1);
    const eq = rec.indexOf('=');
    if (rec.slice(0, eq) === 'path') out = rec.slice(eq + 1);
    i += len;
  }
  return out;
}

// → [{ name, type: 'file' | 'dir', data }]
function list(tgz) {
  const buf = tgz[0] === 0x1f && tgz[1] === 0x8b ? zlib.gunzipSync(tgz) : tgz;
  const out = [];
  let off = 0;
  let longName = null;
  while (off + 512 <= buf.length) {
    const h = buf.slice(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const size = octal(h, 124, 12);
    const flag = String.fromCharCode(h[156] || 48);
    const prefix = str(h, 257, 6).startsWith('ustar') ? str(h, 345, 155) : '';
    let name = str(h, 0, 100);
    if (prefix) name = `${prefix}/${name}`;
    const data = buf.slice(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (flag === 'x') { longName = paxPath(data) || longName; continue; }
    if (flag === 'g') continue;
    if (flag === 'L') { longName = str(data, 0, data.length); continue; }
    if (longName) { name = longName; longName = null; }
    if (flag === '5') out.push({ name, type: 'dir', data: Buffer.alloc(0) });
    else if (flag === '0' || flag === '\0' || flag === '7') out.push({ name, type: 'file', data: Buffer.from(data) });
    // links and devices are skipped: a Huntboard release has none
  }
  return out;
}

// Make a .tar (for tests): entries [{ name, data }].
function pack(entries) {
  const blocks = [];
  for (const e of entries) {
    const data = Buffer.from(e.data || '');
    const h = Buffer.alloc(512);
    h.write(e.name, 0, 100, 'utf8');
    h.write('0000644\0', 100);
    h.write('0000000\0', 108);
    h.write('0000000\0', 116);
    h.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124);
    h.write('00000000000\0', 136);
    h.write('        ', 148);
    h[156] = 48;
    h.write('ustar\0', 257);
    h.write('00', 263);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
    blocks.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

module.exports = { list, pack };
