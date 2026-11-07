// Reads the ticket details out of a job ad's text: location, on site / hybrid / remote, job type, salary, apply-by
// date and contact person. Heuristic and conservative: a field it is unsure of stays empty, and callers only fill
// fields the ticket does not have yet (a value the user typed is never replaced).
//
// extract(text, extra) -> { location, mode, job_type, salary, deadline, contact } (only the ones found)
// extra: what the source gave besides the text ({ location, city, salary, job_type, mode, contact, deadline }),
// which wins over the text.

const MONTHS = {
  jan: 1, januar: 1, january: 1, feb: 2, februar: 2, february: 2, 'mär': 3, maerz: 3, 'märz': 3, mar: 3, march: 3,
  apr: 4, april: 4, mai: 5, may: 5, jun: 6, juni: 6, june: 6, jul: 7, juli: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, okt: 10, oktober: 10, oct: 10, october: 10, nov: 11, november: 11,
  dez: 12, dezember: 12, dec: 12, december: 12,
};
const MONTH_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');
const pad = (n) => String(n).padStart(2, '0');
const clean = (s, n = 200) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

function isoDate(y, m, d) {
  y = Number(y); m = Number(m); d = Number(d);
  if (y < 100) y += 2000;
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2020 && y <= 2100)) return '';
  return `${y}-${pad(m)}-${pad(d)}`;
}

// The first date in s: 30.11.2026, 30.11.26, 2026-11-30, 30. November 2026, November 30, 2026, 30 Nov 2026.
function firstDate(s) {
  const pats = [
    [/\b(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4}|\d{2})\b/, (m) => isoDate(m[3], m[2], m[1])],
    [/\b(\d{4})-(\d{2})-(\d{2})\b/, (m) => isoDate(m[1], m[2], m[3])],
    [new RegExp(`\\b(\\d{1,2})\\.?\\s+(${MONTH_RE})\\.?\\s+(\\d{4})\\b`, 'i'), (m) => isoDate(m[3], MONTHS[m[2].toLowerCase()], m[1])],
    [new RegExp(`\\b(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'i'), (m) => isoDate(m[3], MONTHS[m[1].toLowerCase()], m[2])],
  ];
  let best = null;
  for (const [re, fn] of pats) {
    const m = s.match(re);
    if (m) {
      const v = fn(m);
      if (v && (!best || m.index < best.at)) best = { at: m.index, v };
    }
  }
  return best ? best.v : '';
}

function deadline(text) {
  const re = /(bewerbungs(?:frist|schluss|ende)|bewerb\w*[^.\n]{0,60}?\bbis\b|einsendeschluss|apply (?:by|before|until)|application deadline|closing date|deadline for applications?|applications? (?:close|by|until))/gi;
  for (const m of text.matchAll(re)) {
    const d = firstDate(text.slice(m.index + m[0].length, m.index + m[0].length + 60));
    if (d) return d;
  }
  return '';
}

const NAME = "[A-ZÄÖÜ][a-zäöüß'-]+(?:[ -](?:von |van |de |zu )?[A-ZÄÖÜ][a-zäöüß'-]+){1,2}";
const TITLED = new RegExp(`\\b(?:Frau|Herr|Mr\\.?|Mrs\\.?|Ms\\.?)\\s+(?:(?:Dr|Prof)\\.\\s+)*${NAME.replace('{1,2}', '{0,2}')}`);
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;

// Two or three capitalised words that are not headings or German nouns ("Weitere Vorteile", "Ihre Bewerbung").
const NOT_NAME = /\b(GmbH|AG|KG|SE|Team|Abteilung|Recruiting|Human|Resources|Personal|Bewerbung|Wir|Sie|Ihr|Ihre|Unser|Unsere|Weitere|Vorteile|Kontakt|Benefits|Jetzt|Online|Bitte|Fragen|Telefon|Mail|Stelle|Unternehmen|Talent|Acquisition|Karriere|Standort|Bereich|Leitung|Manager|Senior|Junior|People|Hiring|Recruiter|Recruiterin|Referenz|Kennziffer|Gerne|Viele|Mehr)\b/;
const looksLikeName = (s) => !NOT_NAME.test(s) && !s.split(/[ -]/).some((w) => /(ung|heit|keit|ion|schaft|ität|teile|ment|ismus|ik|en)$/.test(w) && w.length > 6);

function contact(text) {
  const re = /(ansprechpartner(?:in)?|ansprechperson|ihr(?:e)? kontakt|kontaktperson|contact person|your contact|recruiter|hiring manager|fragen (?:beantwortet|vorab)|for questions)/gi;
  for (const m of text.matchAll(re)) {
    const win = text.slice(m.index + m[0].length, m.index + m[0].length + 260);
    let name = (win.match(TITLED) || [])[0];
    if (!name) {
      // "Ansprechpartnerin\nAnna Schmidt\nRecruiting" or "Ihr Kontakt: Anna Schmidt"
      const lines = win.split('\n').map((l) => l.replace(/^[\s:–-]+/, '').trim()).filter(Boolean).slice(0, 3);
      const hit = lines.map((l) => l.match(new RegExp(`^(?:(?:Dr|Prof)\\.\\s+)*${NAME}`))).find(Boolean);
      name = hit && hit[0].length <= 40 && looksLikeName(hit[0]) ? hit[0] : '';
    }
    const mail = (win.match(EMAIL) || [])[0];
    if (name || mail) return clean([name, mail].filter(Boolean).join(', '));
  }
  const name = (text.match(TITLED) || [])[0];
  return name ? clean(name) : '';
}

function mode(text) {
  const t = text.toLowerCase();
  if (/\b(100\s?%|fully|full|vollständig|komplett|ausschließlich|rein)[\s-]*(remote|homeoffice|home office|mobil)|remote[- ]first|\(remote\)|remote only/.test(t)) return 'Remote';
  if (/\bhybrid|\(hybrid\)|homeoffice|home[- ]office|mobile[sn]? arbeiten|remote[- ](?:anteil|tage|days?)|\d\s?(?:tage?|days?)\s+(?:remote|homeoffice|home office)|teilweise remote|partly remote|remote (?:option|possible|möglich)/.test(t)) return 'Hybrid';
  if (/\bvor ort\b|\bon[- ]?site\b|\bpräsenz|\bin office\b|kein homeoffice|no remote/.test(t)) return 'On site';
  if (/\bremote\b/.test(t)) return 'Remote';
  return '';
}

function jobType(text) {
  const t = text.toLowerCase();
  const out = [];
  if (/\bvollzeit|\bfull[- ]time\b/.test(t)) out.push('Full-time');
  if (/\bteilzeit|\bpart[- ]time\b/.test(t)) out.push('Part-time');
  if (/\bwerkstudent/.test(t)) out.push('Working student');
  if (/\bpraktikum|\binternship\b/.test(t)) out.push('Internship');
  if (/\bunbefristet|\bfestanstellung|\bpermanent (?:position|contract|employment|role)|\bpermanent\b(?= *[,|\n])/.test(t)) out.push('Permanent');
  else if (/(?<!un)befristet|\bfixed[- ]term|\btemporary (?:position|contract)/.test(t)) out.push('Fixed-term');
  if (/arbeitnehmerüberlassung|\bzeitarbeit|\banü\b/.test(t)) out.push('Temp agency (ANÜ)');
  if (/\bfreelance|\bfreiberuflich/.test(t)) out.push('Freelance');
  return out.join(', ');
}

const AMOUNT = String.raw`\d{1,3}(?:[.,  ]\d{3})+(?:,\d{2})?|\d{2,3}(?:[.,]\d)?\s?[kK]\b|\d{2},\d{2}`;
const CUR = String.raw`€|EUR\b|Euro\b`;
const SALARY = new RegExp(String.raw`(?:(?:${CUR})\s?)?(?:${AMOUNT})(?:\s?(?:${CUR}))?(?:\s?(?:-|–|bis|to)\s?(?:(?:${CUR})\s?)?(?:${AMOUNT})(?:\s?(?:${CUR}))?)?`, 'g');
const PER = /^[\s,]*(brutto|gross)?[\s,]*(pro jahr|jährlich|im jahr|p\.\s?a\.?|per year|per annum|annually|\/\s?jahr|\/\s?year|pro monat|monatlich|per month|\/\s?monat|\/\s?month|pro stunde|per hour|\/\s?h\b|\/\s?std\.?|stundenlohn)?[\s,]*(brutto|gross)?/i;

function salary(text) {
  for (const m of text.matchAll(SALARY)) {
    const s = m[0];
    if (!new RegExp(CUR).test(s) && !/gehalt|salary|vergütung|verdienst|stundenlohn|jahresgehalt|compensation/i.test(text.slice(Math.max(0, m.index - 60), m.index))) continue;
    const nums = s.match(new RegExp(AMOUNT, 'g')) || [];
    const val = (n) => /k/i.test(n) ? parseFloat(n.replace(',', '.')) * 1000 : parseFloat(n.replace(/[.  ](?=\d{3})/g, '').replace(',', '.'));
    const v = nums.map(val);
    const per = (text.slice(m.index + s.length, m.index + s.length + 40).match(PER) || [])[0] || '';
    const hourly = /stunde|hour|\/\s?h\b|std/i.test(per);
    if (!v.length || v.some((x) => !(hourly ? x >= 10 && x <= 200 : x >= 1000 && x <= 400000))) continue;
    if (!hourly && v.every((x) => x < 1500)) continue;
    return clean(`${s}${per.trim() ? ' ' + per.trim() : ''}`, 120);
  }
  return '';
}

const PLZ = /\b\d{5}\s+([A-ZÄÖÜ][a-zäöüß]+(?:(?:-|\s(?:am|an der|im|bei|ob der|in der)\s|\s)[A-ZÄÖÜ][a-zäöüß.]+)?)/;
const NOT_A_PLACE = /^(vor ort|on[- ]?site|remote|hybrid|homeoffice|home office|deutschland|germany|deu|de|bundesweit|europe|europa|mehrere standorte|various)$/i;

// A place from a "Standort:" value or a city column: "Remscheid-DEU" -> Remscheid, "Pforzheim Anstellungsart(en):
// Schicht" -> Pforzheim, a sentence -> its postcode town or nothing, "Deutschland" / "Vor Ort" -> nothing.
function place(v) {
  let s = clean(v, 200).replace(/\s+\S+:.*$/, '').replace(/[-,\s]+(DEU|DE|Deutschland|Germany)$/i, '').trim();
  const plz = s.match(PLZ);
  if (s.split(/\s+/).length > 6) s = plz ? plz[1] : '';
  return s && !NOT_A_PLACE.test(s) && s.length <= 80 ? s : '';
}

function location(text) {
  const lab = text.match(/(?:^|\n)\s*(?:standort|arbeitsort|einsatzort|dienstort|location|job location|work location|ort)\s*[:|]\s*([^\n]{2,120})/i);
  const v = lab && place(lab[1]);
  if (v) return v;
  // "Gasanstaltstraße 10, 01237 Dresden" (Indeed), "80331 München"
  const plz = text.match(PLZ);
  return plz ? plz[1] : '';
}

function extract(text, extra = {}) {
  const s = String(text || '');
  const head = s.slice(0, 20000);
  const out = {
    location: place(extra.location) || place(extra.city) || location(head),
    mode: clean(extra.mode, 40) || mode(`${extra.location || ''}\n${head}`),
    job_type: clean(extra.job_type, 120) || jobType(head),
    salary: clean(extra.salary, 120) || salary(head),
    deadline: clean(extra.deadline, 40) || deadline(s),
    contact: clean(extra.contact, 200) || contact(s),
  };
  for (const k of Object.keys(out)) if (!out[k]) delete out[k];
  return out;
}

const DETAIL_FIELDS = ['location', 'mode', 'job_type', 'salary', 'deadline', 'contact'];

module.exports = { extract, DETAIL_FIELDS, firstDate, _: { mode, jobType, salary, deadline, contact, location, place } };
