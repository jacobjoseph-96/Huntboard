// The user's documents: CV, degrees, certificates, references, portfolio, photo...
// Files are copied to workspace/documents/<type>/, described in documents.json, and their text is
// extracted to <file>.txt so every AI model can read them (not only models that read PDFs).

const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const { ensureDir, readJson, writeJson, writeAtomic, slugify, newId, nowIso, safeJoin } = require('./fsx');
const { withLock } = require('./lock');

const DOC_TYPES = [
  ['cv', 'CV / résumé', false],
  ['degree', 'Degree / diploma', false],
  ['transcript', 'Transcript of records', false],
  ['certificate', 'Training / professional certificate', false],
  ['language_certificate', 'Language certificate', false],
  ['reference', 'Employer reference / work certificate', false],
  ['recommendation', 'Recommendation letter', false],
  ['recognition', 'Degree recognition / equivalence', false],
  ['portfolio', 'Portfolio / work samples', false],
  ['photo', 'Photo for the CV', false],
  ['driving_licence', 'Driving licence', true],
  ['work_permit', 'Work permit / visa', true],
  ['id_document', 'ID document', true],
  ['other', 'Other', false],
];

const TEXT_EXT = ['.txt', '.md', '.markdown', '.json', '.html', '.htm', '.rtf'];
const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic'];
const MAX_BYTES = 25 * 1024 * 1024;

function list() {
  return readJson(paths.documentsIndex(), { documents: [] }).documents;
}

function saveIndex(docs) {
  writeJson(paths.documentsIndex(), { documents: docs });
}

function get(id) {
  return list().find((d) => d.id === id) || null;
}

function absPath(doc) {
  return safeJoin(paths.documentsDir(), doc.file);
}

// Add a document from a local file (srcPath) or from uploaded bytes (data: Buffer, filename).
async function add({ type = 'other', title, filename, data, srcPath, issuer = '', date = '', language = '', sensitive, attach } = {}) {
  if (!DOC_TYPES.some(([k]) => k === type)) type = 'other';
  if (srcPath) {
    data = fs.readFileSync(srcPath);
    filename = filename || path.basename(srcPath);
  }
  if (!data || !filename) throw new Error('A document needs a file.');
  if (data.length > MAX_BYTES) throw new Error('This file is larger than 25 MB.');
  const ext = path.extname(filename).toLowerCase().slice(0, 8);
  const id = newId('doc-');
  const rel = `${type}/${id.slice(-6)}-${slugify(path.basename(filename, ext), 50)}${ext}`;
  const file = safeJoin(paths.documentsDir(), rel);
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, data);
  const typeInfo = DOC_TYPES.find(([k]) => k === type);
  const doc = {
    id,
    type,
    title: title || path.basename(filename, ext),
    file: rel,
    original_name: path.basename(filename),
    size: data.length,
    issuer,
    date,
    language,
    sensitive: sensitive == null ? typeInfo[2] : Boolean(sensitive),
    attach: attach == null ? !typeInfo[2] && !['cv', 'photo', 'portfolio', 'other'].includes(type) : Boolean(attach),
    added_at: nowIso(),
    text_file: null,
    text_status: 'pending',
  };
  withLock('documents', () => saveIndex([...list(), doc]));
  await extract(doc.id);
  return get(doc.id);
}

function update(id, patch) {
  return withLock('documents', () => {
    const docs = list();
    const d = docs.find((x) => x.id === id);
    if (!d) throw new Error(`No document ${id}`);
    for (const k of ['title', 'issuer', 'date', 'language']) if (k in patch) d[k] = String(patch[k] || '').slice(0, 300);
    if ('type' in patch && DOC_TYPES.some(([k]) => k === patch.type)) d.type = patch.type;
    for (const k of ['sensitive', 'attach']) if (k in patch) d[k] = Boolean(patch[k]);
    saveIndex(docs);
    return d;
  });
}

function remove(id) {
  return withLock('documents', () => {
    const docs = list();
    const d = docs.find((x) => x.id === id);
    if (!d) return false;
    const trash = path.join(paths.documentsDir(), '.removed');
    ensureDir(trash);
    for (const rel of [d.file, d.text_file].filter(Boolean)) {
      const f = safeJoin(paths.documentsDir(), rel);
      if (f && fs.existsSync(f)) fs.renameSync(f, path.join(trash, `${Date.now()}-${path.basename(f)}`));
    }
    saveIndex(docs.filter((x) => x.id !== id));
    return true;
  });
}

async function extractText(file) {
  const ext = path.extname(file).toLowerCase();
  if (TEXT_EXT.includes(ext)) {
    let t = fs.readFileSync(file, 'utf8');
    if (ext === '.html' || ext === '.htm') t = t.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
    return { text: t, status: 'ok' };
  }
  if (ext === '.pdf') {
    const { extractText: pdfText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(fs.readFileSync(file)));
    const { text } = await pdfText(pdf, { mergePages: true });
    const clean = String(text || '').replace(/[ \t]+\n/g, '\n').trim();
    // Scanned PDFs have (almost) no text layer.
    return clean.length > 40 ? { text: clean, status: 'ok' } : { text: clean, status: 'needs_review' };
  }
  if (ext === '.docx') {
    const mammoth = require('mammoth');
    const { value } = await mammoth.extractRawText({ path: file });
    return { text: value, status: value.trim() ? 'ok' : 'needs_review' };
  }
  if (IMAGE_EXT.includes(ext)) return { text: '', status: 'image' };
  return { text: '', status: 'unsupported' };
}

async function extract(id) {
  const d = get(id);
  if (!d) throw new Error(`No document ${id}`);
  let result;
  try {
    result = await extractText(absPath(d));
  } catch (err) {
    result = { text: '', status: 'error', error: String(err.message || err).slice(0, 300) };
  }
  const textRel = result.text ? d.file.replace(/\.[^./]+$/, '') + '.txt' : null;
  if (textRel) writeAtomic(safeJoin(paths.documentsDir(), textRel), result.text.trim() + '\n');
  return withLock('documents', () => {
    const docs = list();
    const x = docs.find((y) => y.id === id);
    if (!x) return null;
    x.text_file = textRel;
    x.text_status = result.status;
    x.text_chars = result.text ? result.text.length : 0;
    if (result.error) x.text_error = result.error;
    saveIndex(docs);
    return x;
  });
}

function readText(id) {
  const d = get(id);
  if (!d || !d.text_file) return '';
  const f = safeJoin(paths.documentsDir(), d.text_file);
  return f && fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
}

function typeLabel(type) {
  return (DOC_TYPES.find(([k]) => k === type) || [type, type])[1];
}

module.exports = { DOC_TYPES, list, get, add, update, remove, extract, readText, absPath, typeLabel };
