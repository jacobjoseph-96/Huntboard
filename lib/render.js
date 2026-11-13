// Renders the CV and cover letters from JSON (written by the AI) to HTML and A4 PDF.
// The AI never writes HTML: layout, labels and date formats come from templates/ and stay consistent.
// A CV's look is a template: a stylesheet plus a few layout choices (templates/cv/, or the user's own design in
// workspace/profile/cv_design/). The HTML is the same for all of them; templates/cv/README.md describes it.

const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const { writeAtomic, writeJson, readJson, slugify, ensureDir } = require('./fsx');
const documents = require('./documents');
const cvLib = require('./cv');
const { htmlToPdf, htmlToPng } = require('./pdf');

const TPL = path.join(paths.ROOT, 'templates');
const CV_TPL = path.join(TPL, 'cv');
const LOCALES = JSON.parse(fs.readFileSync(path.join(TPL, 'locales.json'), 'utf8'));
const REGISTRY = JSON.parse(fs.readFileSync(path.join(CV_TPL, 'templates.json'), 'utf8'));

const SECTIONS = ['profile', 'skills', 'experience', 'education', 'certificates', 'languages', 'references', 'other'];
const SIDE_SECTIONS = ['contact', ...SECTIONS];
const OWN = 'own';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LANG_CODES = { english: 'en', italian: 'it', italiano: 'it', german: 'de', deutsch: 'de', french: 'fr', français: 'fr', spanish: 'es', español: 'es', portuguese: 'pt', dutch: 'nl', polish: 'pl' };
const PRESENT = /^(present|now|current|currently|today|ongoing|oggi|ad oggi|heute|bis heute|aujourd'hui|actualidad|actualmente|atual|atualmente|heden|obecnie)$/i;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function locale(lang) {
  const code = LOCALES[lang] ? lang : LANG_CODES[String(lang || '').toLowerCase()] || 'en';
  return { code, ...LOCALES.en, ...LOCALES[code] };
}

function fmtDate(v, L) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (PRESENT.test(s)) return L.present;
  const m = s.match(/^(\d{4})(?:-(\d{1,2}))?/);
  if (!m) return s;
  if (!m[2]) return m[1];
  return L.dates === 'mon yyyy' ? `${L.months[Number(m[2]) - 1]} ${m[1]}` : `${m[2].padStart(2, '0')}/${m[1]}`;
}

const span = (a, b, L) => [fmtDate(a, L), fmtDate(b, L)].filter(Boolean).join(' – ');

// A date as a number of months, to sort by. Reads "2024", "2024-05", "05/2024", "05.2024", "May 2024", "present".
// A bare year counts as December for an end date and as January for a start date.
function dateKey(v, isEnd) {
  const s = String(v || '').trim();
  if (!s) return null;
  if (PRESENT.test(s)) return Infinity;
  let m = s.match(/^(\d{4})(?:[-/.](\d{1,2}))?(?!\d)/);
  if (m) return Number(m[1]) * 12 + (m[2] ? Number(m[2]) : isEnd ? 12 : 1);
  m = s.match(/^(\d{1,2})[-/.](\d{4})$/);
  if (m) return Number(m[2]) * 12 + Number(m[1]);
  m = s.match(/([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{4})/);
  if (m) {
    const month = MONTHS.indexOf(m[1].toLowerCase()) + 1;
    return Number(m[2]) * 12 + (month || (isEnd ? 12 : 1));
  }
  m = s.match(/(\d{4})/);
  return m ? Number(m[1]) * 12 + (isEnd ? 12 : 1) : null;
}

// Newest first, as every country's CV custom expects: by end date ("present" on top), then by start date.
// Entries without any date keep their place at the end.
function sortNewestFirst(list) {
  const key = (e) => {
    const start = dateKey(e && e.start, false);
    const end = dateKey(e && e.end, true);
    return { end: end == null ? (start == null ? -Infinity : start) : end, start: start == null ? -Infinity : start };
  };
  const cmp = (a, b) => (a === b ? 0 : a > b ? -1 : 1);
  return (list || []).map((e, i) => ({ e, i, k: key(e) }))
    .sort((a, b) => cmp(a.k.end, b.k.end) || cmp(a.k.start, b.k.start) || a.i - b.i)
    .map((x) => x.e);
}

// Merge per-job changes into the base CV: title, summary, skills replace; experience bullets per company.
// The order of the jobs is never changed here: a CV always prints newest first.
function merge(cvIn, ovIn = {}) {
  const out = cvLib.normalize(JSON.parse(JSON.stringify(cvIn)));
  const ov = ovIn || {};
  if (ov.title) out.headline = ov.title;
  if (ov.headline) out.headline = ov.headline;
  if (ov.summary) out.summary = ov.summary;
  if (Array.isArray(ov.skills)) out.skills = cvLib.normalize({ skills: ov.skills }).skills;
  if (Array.isArray(ov.experience)) {
    const same = (a, b) => a && b && String(a).toLowerCase() === String(b).toLowerCase();
    for (const o of ov.experience) {
      const e = (out.experience || []).find((x) => same(x.company, o.company) && (!o.title || !x.title || same(x.title, o.title)))
        || (out.experience || []).find((x) => same(x.company, o.company));
      if (e && Array.isArray(o.bullets)) e.bullets = o.bullets;
      if (e && o.tech != null) e.tech = Array.isArray(o.tech) ? o.tech.join(' · ') : String(o.tech);
    }
  }
  if (Array.isArray(ov.hide_sections)) out.hidden = [...new Set([...(out.hidden || []), ...ov.hide_sections])];
  return out;
}

// ---- photo ----------------------------------------------------------------------------------------
const PHOTO_EXT = { '.jpg': 'jpeg', '.jpeg': 'jpeg', '.png': 'png', '.webp': 'webp', '.gif': 'gif' };

function photoDoc() {
  const photos = documents.list().filter((d) => d.type === 'photo' && PHOTO_EXT[path.extname(d.file).toLowerCase()]);
  return photos.length ? photos[photos.length - 1] : null;
}

function photoData() {
  const photo = photoDoc();
  if (!photo) return null;
  const file = documents.absPath(photo);
  if (!file || !fs.existsSync(file)) return null;
  return `data:image/${PHOTO_EXT[path.extname(file).toLowerCase()]};base64,${fs.readFileSync(file).toString('base64')}`;
}

// ---- templates ------------------------------------------------------------------------------------
const designDir = () => path.join(paths.profileDir(), 'cv_design');

// A custom stylesheet goes into the page as it is, so it may not close the <style> block or load anything
// from outside (the CV must render the same offline, and nothing about the user may leave the computer).
function checkCss(css) {
  const problems = [];
  const text = String(css || '');
  if (/</.test(text)) problems.push('it contains "<" (only plain CSS is allowed)');
  if (/@import/i.test(text)) problems.push('it uses @import');
  if (/url\(\s*(?!["']?data:)/i.test(text)) problems.push('it loads a file with url(...) (only data: images are allowed)');
  if (/expression\s*\(|javascript:/i.test(text)) problems.push('it contains script');
  return problems;
}

function cleanLayout(t) {
  const layout = t.layout === 'sidebar' ? 'sidebar' : 'single';
  const uniq = (list, allowed) => [...new Set((Array.isArray(list) ? list : []).filter((s) => allowed.includes(s)))];
  const side = layout === 'sidebar' ? uniq(t.side, SIDE_SECTIONS) : [];
  const sections = uniq(t.sections, SECTIONS).filter((s) => !side.includes(s));
  // Nothing the CV contains may vanish because a design forgot to place it.
  for (const s of SECTIONS) if (!sections.includes(s) && !side.includes(s)) sections.push(s);
  return { layout, side, sections, footer: Boolean(t.footer), sep: typeof t.sep === 'string' && t.sep.length <= 5 ? t.sep : ' · ' };
}

function ownDesign() {
  const meta = readJson(path.join(designDir(), 'design.json'), null);
  const cssFile = path.join(designDir(), 'design.css');
  if (!meta || !fs.existsSync(cssFile)) return null;
  return {
    id: OWN, name: 'My own design', good_for: 'The look of your own CV', description: meta.description || 'Made from the CV you uploaded.',
    ats: ['safe', 'weak'].includes(meta.ats) ? meta.ats : meta.layout === 'sidebar' ? 'weak' : 'safe', own: true, ...cleanLayout(meta),
  };
}

function templates() {
  const list = REGISTRY.templates.map((t) => ({ id: t.id, name: t.name, good_for: t.good_for, description: t.description, ats: t.ats, own: false, ...cleanLayout(t) }));
  const own = ownDesign();
  return own ? [...list, own] : list;
}

const DEFAULT_TEMPLATE = REGISTRY.default;

// The template to render with, including its CSS. An unknown id falls back to the default design.
function template(id) {
  const list = templates();
  const t = list.find((x) => x.id === id) || list.find((x) => x.id === DEFAULT_TEMPLATE) || list[0];
  const base = fs.readFileSync(path.join(CV_TPL, 'base.css'), 'utf8');
  let css;
  if (t.own) {
    css = fs.readFileSync(path.join(designDir(), 'design.css'), 'utf8');
    const problems = checkCss(css);
    if (problems.length) throw new Error(`Your own CV design cannot be used: ${problems.join('; ')}. Fix workspace/profile/cv_design/design.css or choose another template.`);
  } else {
    css = fs.readFileSync(path.join(CV_TPL, `${t.id}.css`), 'utf8');
  }
  return { ...t, css: `${base}\n${css}` };
}

// Start the user's own design from a ready-made one: the AI then edits the two files to match the user's CV.
function initDesign(fromId) {
  const from = REGISTRY.templates.find((t) => t.id === fromId);
  if (!from) throw new Error(`No template "${fromId}". Choose one of: ${REGISTRY.templates.map((t) => t.id).join(', ')}.`);
  ensureDir(designDir());
  const meta = { based_on: from.id, description: '', ...cleanLayout(from), ats: from.ats };
  writeJson(path.join(designDir(), 'design.json'), meta);
  writeAtomic(path.join(designDir(), 'design.css'), fs.readFileSync(path.join(CV_TPL, `${from.id}.css`), 'utf8'));
  return designDir();
}

// ---- CV -------------------------------------------------------------------------------------------
const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
const linkKey = (l) => String(l).toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '');

function cvHtml(cvIn, profile, { lang, photo = null, extras = {}, template: tplIn } = {}) {
  const L = locale(lang);
  const T = tplIn && tplIn.css ? tplIn : template(tplIn);
  const cv = cvLib.normalize(cvIn) || {};
  const p = profile.person || {};
  const c = cv.contact || {};
  const a = profile.about || {};
  const hidden = new Set(cv.hidden || []);
  const row = (cls, items) => (items.length ? `<div class="${cls}">${items.map((x) => `<span class="c-item">${x}</span>`).join(`<span class="sep">${esc(T.sep)}</span>`)}</div>` : '');

  // -- who --
  const email = c.email || p.email;
  const contact = [
    [c.address || p.address || [c.city || p.city, c.country || p.country].filter(Boolean).join(', '), esc],
    [c.phone || p.phone, esc],
    [email, (v) => `<a href="mailto:${esc(v)}">${esc(v)}</a>`],
  ].filter(([v]) => v).map(([v, f]) => f(v));
  const seen = new Set();
  const links = ((c.links || []).length ? c.links : p.links || []).filter((l) => l && !seen.has(linkKey(l)) && seen.add(linkKey(l)))
    .map((l) => `<a href="${esc(/^https?:/.test(l) ? l : `https://${l}`)}">${esc(String(l).replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, ''))}</a>`);
  const personal = [
    extras.birth_date && p.birth_date ? `<b>${esc(L.born)}:</b> ${esc(p.birth_date)}` : '',
    extras.nationality && p.nationality ? `<b>${esc(L.nationality)}:</b> ${esc(p.nationality)}` : '',
  ].filter(Boolean);
  const contactBlock = row('contact', contact) + row('links', links) + row('personal', personal) + row('extra', (c.extra || []).map(esc));

  // -- sections --
  const when = (e) => {
    const d = span(e.start, e.end, L);
    return d ? `<div class="when">${esc(d)}</div>` : '';
  };
  const line2 = (org, where) => (org || where ? `<div class="line2">${org ? `<span class="org">${esc(org)}</span>` : ''}${where ? `<span class="where">${esc(where)}</span>` : ''}</div>` : '');
  // An entry is a flat list of lines in reading order (title, dates, organisation, details). The stylesheet
  // moves the dates (right, left column, above); the text in the PDF keeps this order, which is what the
  // software of application forms reads.
  const title = (t) => `<div class="line1"><span class="title">${esc(t)}</span></div>`;
  const exp = sortNewestFirst(cv.experience).map((e) => `<div class="entry">${title(e.title)}${when(e)}${line2(e.company, e.location)}
${(e.bullets || []).length ? `<ul>${e.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}${e.tech ? `<div class="tech"><b>${esc(L.technologies)}:</b> ${esc(e.tech)}</div>` : ''}</div>`).join('\n');
  const edu = sortNewestFirst(cv.education).map((e) => `<div class="entry">${title(e.degree)}${when(e)}${line2(e.school, e.location)}
${e.grade ? `<div class="grade">${esc(L.grade)}: ${esc(e.grade)}</div>` : ''}${e.recognition ? `<div class="recognition">${/^https?:\/\//.test(e.recognition_url || '') ? `<a href="${esc(e.recognition_url)}">${esc(e.recognition)}</a>` : esc(e.recognition)}</div>` : ''}${e.note ? `<div class="note">${esc(e.note)}</div>` : ''}</div>`).join('\n');
  const certs = (cv.certificates || []).filter((x) => x && x.name).map((x) => `<div class="entry">${title(x.name)}${x.date ? `<div class="when">${esc(fmtDate(x.date, L))}</div>` : ''}${line2(x.issuer, '')}</div>`).join('\n');
  // "English: C1": the language first, then its level, as the user's CV states it.
  const langs = (cv.languages && cv.languages.length ? cv.languages : a.languages || []).filter((l) => l && l.name)
    .map((l) => `<span class="lang">${l.level ? `<b>${esc(l.name)}:</b> ${esc(/^native$/i.test(l.level) ? cap(L.native) : l.level)}` : `<b>${esc(l.name)}</b>`}</span>`)
    .join(`<span class="sep">${esc(T.sep)}</span>`);
  const skills = (cv.skills || []).map((g) => {
    if (typeof g === 'string') return g.trim() ? `<div class="skill nogroup"><span class="items">${esc(g)}</span></div>` : '';
    const items = (g.items || []).join(', ');
    if (!items && !g.group) return '';
    return g.group ? `<div class="skill"><span class="group">${esc(g.group)}<span class="colon">:</span></span> <span class="items">${esc(items)}</span></div>`
      : `<div class="skill nogroup"><span class="items">${esc(items)}</span></div>`;
  }).join('');
  const other = [
    extras.availability ? `<b>${esc(L.availability)}:</b> ${esc(extras.availability)}` : '',
    extras.work_permit && a.work_permit ? `<b>${esc(L.work_permit)}:</b> ${esc(a.work_permit)}` : '',
    a.driving_licence && !/^(no|none|nessuna|keine?)$/i.test(a.driving_licence) ? `<b>${esc(L.driving_licence)}:</b> ${esc(a.driving_licence)}` : '',
    ...(cv.other || []).map((o) => esc(typeof o === 'string' ? o : (o && o.text) || '')),
  ].filter(Boolean).map((x) => `<div class="o-line">${x}</div>`).join('');
  const refs = extras.references ? (cv.references || []).filter((r) => r && r.quote).map((r) => `<div class="entry"><span class="quote">“${esc(r.quote)}”</span> <span class="by">${esc([r.from, r.role, r.company].filter(Boolean).join(', '))}</span></div>`).join('') : '';

  const bodies = {
    contact: contactBlock,
    profile: cv.summary ? `<p class="summary">${esc(cv.summary)}</p>` : '',
    skills: skills ? `<div class="skills">${skills}</div>` : '',
    experience: exp,
    education: edu,
    certificates: certs,
    languages: langs ? `<div class="langs">${langs}</div>` : '',
    references: refs ? `<div class="refs">${refs}</div>` : '',
    other: other ? `<div class="other">${other}</div>` : '',
  };
  const section = (key) => (hidden.has(key) || !bodies[key] ? '' : `<section class="sec sec-${key}"><h2>${esc(L[key])}</h2><div class="sec-body">${bodies[key]}</div></section>`);
  const name = cv.name || p.name;
  const sidebar = T.layout === 'sidebar';
  const inSide = sidebar && T.side.includes('contact');

  const today = new Date();
  const dateStr = L.dates === 'mon yyyy' ? `${today.getDate()} ${L.months[today.getMonth()]} ${today.getFullYear()}` : `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
  const place = c.city || p.city || '';
  const privacy = extras.privacy !== false && L.privacy ? `<div class="privacy">${esc(L.privacy)}</div>` : '';
  const footer = T.footer || privacy ? `<footer class="foot">${T.footer ? `<div class="signed">${esc(place)}${place ? ', ' : ''}${esc(dateStr)} · ${esc(name)}</div>` : ''}${privacy}</footer>` : '';

  const head = `<header class="head"><div class="id"><h1 class="name">${esc(name)}</h1>
${cv.headline ? `<div class="headline">${esc(cv.headline)}</div>` : ''}
${inSide ? '' : contactBlock}</div>${photo ? `<img class="photo" src="${photo}" alt="">` : ''}</header>`;
  const main = `<main class="body">\n${T.sections.map(section).filter(Boolean).join('\n')}\n</main>`;
  const columns = sidebar ? `<div class="cols"><aside class="side">\n${T.side.map(section).filter(Boolean).join('\n')}\n</aside>${main}</div>` : main;

  // On a screen (the .html opened in a browser, the preview picture) there is no paper: show the sheet and the
  // paper margins the design asks for with @page, so it looks like the printed page.
  const pageMargin = ((T.css.match(/@page\s*\{[^}]*?margin\s*:\s*([^;}]+)/) || [])[1] || '').trim();
  const screenCss = `@media screen { body { width: 210mm; min-height: 297mm; margin: 0 auto;${pageMargin && !/^0(\s|$)/.test(pageMargin) ? ` padding: ${pageMargin};` : ''} } }`;

  return `<!doctype html><html lang="${L.code}"><head><meta charset="utf-8"><title>${esc(name)} – ${esc(L.cv)}</title>
<style>${T.css}\n${screenCss}</style></head><body class="cv tpl-${esc(T.id)} layout-${T.layout}${photo ? ' has-photo' : ''}">
${head}
${columns}
${footer}
</body></html>`;
}

function letterHtml(letter, profile, { lang } = {}) {
  const L = locale(lang || letter.language);
  const p = profile.person || {};
  const r = letter.recipient || {};
  const today = new Date();
  const dateStr = letter.date || (L.dates === 'mon yyyy' ? `${today.getDate()} ${L.months[today.getMonth()]} ${today.getFullYear()}` : `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`);
  // No "Enclosures: CV" line: the CV travels with the letter anyway. Printed only when the letter asks for one.
  const attach = typeof letter.attachments_line === 'string' && letter.attachments_line.trim() ? `<div class="attach">${esc(letter.attachments_line.trim())}</div>` : '';
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
${attach}
</body></html>`;
}

function writeAndPrint(htmlFile, html) {
  writeAtomic(htmlFile, html);
  const { pdf, pages } = htmlToPdf(htmlFile);
  return { html: htmlFile, pdf, pages };
}

// ---- previews -------------------------------------------------------------------------------------
// What `hunt cv render` prints when no option says otherwise.
function defaultExtras(profile, opt = {}) {
  const answers = (profile.applying && profile.applying.answers) || {};
  return {
    birth_date: Boolean(opt['birth-date']), nationality: Boolean(opt.nationality), work_permit: opt['work-permit'] !== 'no',
    availability: opt.availability || answers.availability || '', references: Boolean(opt.references), privacy: opt.privacy !== 'no',
  };
}

// Should this CV carry the photo? The user's setting decides; "auto" leaves it to the country's custom (--photo yes).
function wantsPhoto(profile, flag) {
  const setting = (profile.cv && profile.cv.photo) || 'auto';
  if (setting === 'never') return false;
  if (setting === 'always') return true;
  return flag === 'yes' || flag === true;
}

const sampleCv = () => cvLib.normalize(readJson(path.join(CV_TPL, 'sample.json')));

// A grey head-and-shoulders shape, so a preview shows where the photo goes before the user has one.
function placeholderPhoto() {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 150"><rect width="120" height="150" fill="#d5dae1"/><circle cx="60" cy="56" r="26" fill="#f4f6f8"/><path d="M12 150c0-30 21-50 48-50s48 20 48 50z" fill="#f4f6f8"/></svg>';
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

// One design shown with the user's own CV, or with the made-up sample person (sample: true, or no CV yet).
// Writes <dir>/<name>.html and .pdf, and a .png of page one when asked.
function preview(templateId, { dir, name, profile, lang = 'en', sample = false, png = false } = {}) {
  const own = sample ? null : cvLib.load();
  const T = template(templateId);
  const html = own
    ? cvHtml(own, profile, { lang, template: T, extras: defaultExtras(profile), photo: (profile.cv || {}).photo === 'never' ? null : photoData() })
    : cvHtml(sampleCv(), { person: {}, about: {} }, { lang, template: T, extras: { privacy: false }, photo: placeholderPhoto() });
  const out = writeAndPrint(path.join(dir, `${name || `cv_preview_${T.id}`}.html`), html);
  if (png) out.png = htmlToPng(out.html, out.html.replace(/\.html$/, '.png'));
  return { ...out, template: T.id, sample: !own };
}

function fileBase(name) {
  return slugify(name || 'cv', 40).replace(/-/g, '_') || 'cv';
}

module.exports = {
  locale, LOCALES, fmtDate, dateKey, sortNewestFirst, merge, cvHtml, letterHtml, writeAndPrint, photoData, photoDoc, fileBase,
  templates, template, DEFAULT_TEMPLATE, OWN, SECTIONS, checkCss, initDesign, designDir, ownDesign,
  defaultExtras, wantsPhoto, sampleCv, placeholderPhoto, preview,
};
