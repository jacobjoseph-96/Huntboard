// Renders the CV and cover letters from JSON (written by the AI) to HTML and A4 PDF.
// The AI never writes HTML: layout, labels and date formats come from templates/ and stay consistent.

const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const { writeAtomic, slugify } = require('./fsx');
const documents = require('./documents');
const { htmlToPdf } = require('./pdf');

const TPL = path.join(paths.ROOT, 'templates');
const LOCALES = JSON.parse(fs.readFileSync(path.join(TPL, 'locales.json'), 'utf8'));

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LANG_CODES = { english: 'en', italian: 'it', italiano: 'it', german: 'de', deutsch: 'de', french: 'fr', français: 'fr', spanish: 'es', español: 'es', portuguese: 'pt', dutch: 'nl', polish: 'pl' };

function locale(lang) {
  const code = LOCALES[lang] ? lang : LANG_CODES[String(lang || '').toLowerCase()] || 'en';
  return { code, ...LOCALES.en, ...LOCALES[code] };
}

function fmtDate(v, L) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (/^(present|now|current|today|oggi|heute|actualidad)$/i.test(s)) return L.present;
  const m = s.match(/^(\d{4})(?:-(\d{1,2}))?/);
  if (!m) return s;
  if (!m[2]) return m[1];
  return L.dates === 'mon yyyy' ? `${L.months[Number(m[2]) - 1]} ${m[1]}` : `${m[2].padStart(2, '0')}/${m[1]}`;
}

const span = (a, b, L) => [fmtDate(a, L), fmtDate(b, L)].filter(Boolean).join(' – ');

// Merge per-job changes into the base CV: title, summary, skills replace; experience bullets per company.
function merge(cv, ov = {}) {
  const out = JSON.parse(JSON.stringify(cv));
  if (ov.title) out.headline = ov.title;
  if (ov.headline) out.headline = ov.headline;
  if (ov.summary) out.summary = ov.summary;
  if (Array.isArray(ov.skills)) out.skills = ov.skills;
  if (Array.isArray(ov.experience)) {
    for (const o of ov.experience) {
      const e = (out.experience || []).find((x) => x.company && o.company && x.company.toLowerCase() === o.company.toLowerCase() && (!o.title || !x.title || x.title.toLowerCase() === o.title.toLowerCase()))
        || (out.experience || []).find((x) => x.company && o.company && x.company.toLowerCase() === o.company.toLowerCase());
      if (e && Array.isArray(o.bullets)) e.bullets = o.bullets;
    }
  }
  if (Array.isArray(ov.hide_sections)) out.hidden = ov.hide_sections;
  if (Array.isArray(ov.order)) out.experience = ov.order.map((c) => (out.experience || []).find((x) => x.company === c)).filter(Boolean).concat((out.experience || []).filter((x) => !ov.order.includes(x.company)));
  return out;
}

function photoData() {
  const photo = documents.list().find((d) => d.type === 'photo');
  if (!photo) return null;
  const file = documents.absPath(photo);
  const ext = path.extname(file).toLowerCase().replace('.', '').replace('jpg', 'jpeg');
  return `data:image/${ext};base64,${fs.readFileSync(file).toString('base64')}`;
}

function cvHtml(cv, profile, { lang, photo = null, extras = {} } = {}) {
  const L = locale(lang);
  const p = profile.person || {};
  const c = cv.contact || {};
  const hidden = new Set(cv.hidden || []);
  const section = (key, body) => (hidden.has(key) || !body ? '' : `<div class="section-head"><span class="dot"></span><h2>${esc(L[key])}</h2></div>${body}`);
  const contact = [
    [c.email || p.email, (v) => `<a href="mailto:${esc(v)}">${esc(v)}</a>`],
    [c.phone || p.phone, esc],
    [c.address || p.address || [c.city || p.city, c.country || p.country].filter(Boolean).join(', '), esc],
  ].filter(([v]) => v).map(([v, f]) => f(v));
  const personal = [
    extras.birth_date && p.birth_date ? `<b>${esc(L.born)}:</b> ${esc(p.birth_date)}` : '',
    extras.nationality && p.nationality ? `<b>${esc(L.nationality)}:</b> ${esc(p.nationality)}` : '',
  ].filter(Boolean);
  const links = [...new Set([...(c.links || []), ...(p.links || [])])];
  const exp = (cv.experience || []).map((e) => `<div class="entry"><div class="meta">${esc(span(e.start, e.end, L))}${e.location ? ` · ${esc(e.location)}` : ''}</div>
    <div class="role-line"><span class="title">${esc(e.title)}</span><span class="org">${esc(e.company)}</span></div>
    ${(e.bullets || []).length ? `<ul>${e.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}</div>`).join('');
  const edu = (cv.education || []).map((e) => `<div class="entry"><div class="meta">${esc(span(e.start, e.end, L))}${e.location ? ` · ${esc(e.location)}` : ''}</div>
    <div class="role-line"><span class="title">${esc(e.degree)}</span><span class="org">${esc(e.school)}</span></div>
    ${e.grade ? `<div class="note">${esc(L.grade)}: ${esc(e.grade)}</div>` : ''}${e.note ? `<div class="note">${esc(e.note)}</div>` : ''}</div>`).join('');
  const certs = (cv.certificates || []).map((x) => `<div class="entry"><div class="role-line"><span class="title">${esc(x.name)}</span><span class="org">${esc([x.issuer, fmtDate(x.date, L)].filter(Boolean).join(', '))}</span></div></div>`).join('');
  const langs = (cv.languages && cv.languages.length ? cv.languages : (profile.about && profile.about.languages) || [])
    .map((l) => `${esc(l.name)}${l.level ? ` (${esc(/^native$/i.test(l.level) ? L.native : l.level)})` : ''}`).join(' · ');
  const skills = (cv.skills || []).map((g) => (typeof g === 'string' ? esc(g) : `${g.group ? `<b>${esc(g.group)}:</b> ` : ''}${esc((g.items || []).join(', '))}`)).join('<br>');
  const a = profile.about || {};
  const other = [
    extras.availability ? `<b>${esc(L.availability)}:</b> ${esc(extras.availability)}` : '',
    extras.work_permit && a.work_permit ? `<b>${esc(L.work_permit)}:</b> ${esc(a.work_permit)}` : '',
    a.driving_licence && !/^(no|none|nessuna|keine?)$/i.test(a.driving_licence) ? `<b>${esc(L.driving_licence)}:</b> ${esc(a.driving_licence)}` : '',
    ...(cv.other || []).map((o) => esc(typeof o === 'string' ? o : o.text || '')),
  ].filter(Boolean).join('<br>');
  const refs = extras.references ? (cv.references || []).filter((r) => r.quote).map((r) => `<div class="entry"><span class="quote">“${esc(r.quote)}”</span> <span class="meta">${esc([r.from, r.role, r.company].filter(Boolean).join(', '))}</span></div>`).join('') : '';
  const today = new Date();
  const dateStr = L.dates === 'mon yyyy' ? `${today.getDate()} ${L.months[today.getMonth()]} ${today.getFullYear()}` : `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
  return `<!doctype html><html lang="${L.code}"><head><meta charset="utf-8"><title>${esc(cv.name || p.name)} – ${esc(L.cv)}</title>
<style>${fs.readFileSync(path.join(TPL, 'cv.css'), 'utf8')}</style></head><body>
<div class="band">${photo ? `<img class="photo" src="${photo}" alt="">` : ''}<div class="id"><h1>${esc(cv.name || p.name)}</h1>
${cv.headline ? `<div class="headline">${esc(cv.headline)}</div>` : ''}
<div class="row">${contact.join('<span class="sep">|</span>')}</div>
${personal.length ? `<div class="row">${personal.join('<span class="sep">|</span>')}</div>` : ''}
${links.length ? `<div class="row">${links.map((l) => `<a href="${esc(/^https?:/.test(l) ? l : `https://${l}`)}">${esc(l.replace(/^https?:\/\/(www\.)?/, ''))}</a>`).join('<span class="sep">|</span>')}</div>` : ''}
</div></div>
<div class="content">
${section('profile', cv.summary ? `<div class="plain">${esc(cv.summary)}</div>` : '')}
${section('experience', exp)}
${section('education', edu)}
${section('certificates', certs)}
${section('languages', langs ? `<div class="plain">${langs}</div>` : '')}
${section('skills', skills ? `<div class="plain skills">${skills}</div>` : '')}
${section('references', refs)}
${section('other', other ? `<div class="plain">${other}</div>` : '')}
</div>
<footer>${esc(c.city || p.city || '')}${c.city || p.city ? ', ' : ''}${esc(dateStr)} · ${esc(cv.name || p.name)}${extras.privacy !== false && L.privacy ? `<div class="privacy">${esc(L.privacy)}</div>` : ''}</footer>
</body></html>`;
}

function letterHtml(letter, profile, { lang } = {}) {
  const L = locale(lang || letter.language);
  const p = profile.person || {};
  const r = letter.recipient || {};
  const today = new Date();
  const dateStr = letter.date || (L.dates === 'mon yyyy' ? `${today.getDate()} ${L.months[today.getMonth()]} ${today.getFullYear()}` : `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`);
  return `<!doctype html><html lang="${L.code}"><head><meta charset="utf-8"><title>${esc(p.name)} – ${esc(letter.subject || '')}</title>
<style>${fs.readFileSync(path.join(TPL, 'letter.css'), 'utf8')}</style></head><body>
<header><h1>${esc(p.name)}</h1><div class="contact">${[p.address || [p.city, p.country].filter(Boolean).join(', '), p.phone, p.email].filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join('')}</div></header>
<div class="recipient">${[r.company, r.contact, ...(r.address_lines || [])].filter(Boolean).map((x) => `<div>${esc(x)}</div>`).join('')}</div>
<div class="date">${esc([letter.place || p.city, dateStr].filter(Boolean).join(', '))}</div>
<h2>${esc(letter.subject || '')}</h2>
<p>${esc(letter.salutation || '')}</p>
${(letter.paragraphs || []).slice(0, 1).map((x) => `<p>${esc(x)}</p>`).join('')}
${(letter.bullets || []).length ? `<ul>${letter.bullets.map((b) => `<li>${typeof b === 'string' ? esc(b) : `<b>${esc(b.label)}</b> – ${esc(b.text)}`}</li>`).join('')}</ul>` : ''}
${(letter.paragraphs || []).slice(1).map((x) => `<p>${esc(x)}</p>`).join('')}
<div class="sign"><div>${esc(letter.closing || '')}</div><div class="name">${esc(letter.signature || p.name)}</div></div>
${letter.attachments_line !== false ? `<div class="attach">${esc(letter.attachments_line || `${L.attachments}: ${L.cv}`)}</div>` : ''}
</body></html>`;
}

function writeAndPrint(htmlFile, html) {
  writeAtomic(htmlFile, html);
  const { pdf, pages } = htmlToPdf(htmlFile);
  return { html: htmlFile, pdf, pages };
}

function fileBase(name) {
  return slugify(name || 'cv', 40).replace(/-/g, '_') || 'cv';
}

module.exports = { locale, LOCALES, fmtDate, merge, cvHtml, letterHtml, writeAndPrint, photoData, fileBase };
