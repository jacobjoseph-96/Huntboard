// Builds one "attachments" PDF (certificates, references, degrees…) for an application, and decides which
// documents go in it: the user's setting, and otherwise the custom of the job's country.

const fs = require('fs');
const path = require('path');
const documents = require('./documents');
const { toIso } = require('./countries');

// Countries where applications usually include certificates and references.
const ATTACH_COUNTRIES = ['DE', 'AT', 'CH', 'LU'];
const ATTACH_TYPES = ['reference', 'degree', 'transcript', 'certificate', 'language_certificate', 'recognition', 'recommendation'];
const MAX_BYTES = 10 * 1024 * 1024;

function choose({ setting = 'country_default', country = '', ids = null } = {}) {
  const docs = documents.list();
  if (ids && ids.length) return docs.filter((d) => ids.includes(d.id));
  if (setting === 'never') return [];
  const iso = toIso(country) || '';
  if (setting === 'country_default' && !ATTACH_COUNTRIES.includes(iso)) return [];
  return docs.filter((d) => d.attach && !d.sensitive && ATTACH_TYPES.includes(d.type));
}

async function build(docs, outFile) {
  const { PDFDocument } = require('pdf-lib');
  const out = await PDFDocument.create();
  const skipped = [];
  for (const d of docs) {
    const file = documents.absPath(d);
    const ext = path.extname(file).toLowerCase();
    const bytes = fs.readFileSync(file);
    try {
      if (ext === '.pdf') {
        const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach((p) => out.addPage(p));
      } else if (['.jpg', '.jpeg', '.png'].includes(ext)) {
        const img = ext === '.png' ? await out.embedPng(bytes) : await out.embedJpg(bytes);
        const page = out.addPage([595.28, 841.89]);
        const scale = Math.min(515 / img.width, 760 / img.height, 1);
        page.drawImage(img, { x: (595.28 - img.width * scale) / 2, y: 841.89 - 40 - img.height * scale, width: img.width * scale, height: img.height * scale });
      } else {
        skipped.push(`${d.title} (${ext} cannot go into a PDF)`);
      }
    } catch (err) {
      skipped.push(`${d.title} (${String(err.message || err).slice(0, 80)})`);
    }
  }
  if (!out.getPageCount()) return { file: null, pages: 0, skipped, warning: 'No document could be added.' };
  const data = await out.save();
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, data);
  return { file: outFile, pages: out.getPageCount(), bytes: data.length, skipped, warning: data.length > MAX_BYTES ? `The file is ${(data.length / 1048576).toFixed(1)} MB; many forms accept only 5–10 MB.` : '' };
}

module.exports = { choose, build, ATTACH_COUNTRIES };
