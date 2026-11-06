// Reads the full text of a job ad: from the API row if it has one, else from the board
// (LinkedIn guest page, Bundesagentur detail API) or the ad page itself (schema.org JobPosting first).

const { request, htmlToText } = require('./http');
const validate = require('./validate');

const JSONLD = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi;

function jobPostingFromHtml(html) {
  for (const m of String(html || '').matchAll(JSONLD)) {
    let data;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const items = Array.isArray(data) ? data : data['@graph'] || [data];
    for (const d of items) {
      const type = d && d['@type'];
      if ((type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'))) && d.description) {
        const org = d.hiringOrganization && typeof d.hiringOrganization === 'object' ? d.hiringOrganization.name : '';
        const addr = d.jobLocation && (Array.isArray(d.jobLocation) ? d.jobLocation[0] : d.jobLocation);
        const place = addr && addr.address ? [addr.address.addressLocality, addr.address.addressRegion].filter(Boolean).join(', ') : '';
        const salary = d.baseSalary && d.baseSalary.value ? [d.baseSalary.value.minValue, d.baseSalary.value.maxValue].filter(Boolean).join('-') + ` ${d.baseSalary.currency || ''} ${d.baseSalary.value.unitText || ''}`.trimEnd() : '';
        const head = [d.title, org, place, d.employmentType && [].concat(d.employmentType).join(', '), salary].filter(Boolean).join(' | ');
        return { text: `${head}\n\n${htmlToText(d.description)}`.trim(), title: d.title, company: org, location: place, posted: String(d.datePosted || '').slice(0, 10), salary, job_type: [].concat(d.employmentType || []).join(', ') };
      }
    }
  }
  return null;
}

function mainText(html) {
  const m = String(html).match(/<main[\s\S]*?<\/main>/i) || String(html).match(/<article[\s\S]*?<\/article>/i);
  return htmlToText(m ? m[0] : html);
}

function linkedinDetail(html) {
  const markup = (String(html).match(/show-more-less-html__markup[^>]*>([\s\S]*?)<\/div>/) || [])[1];
  const criteria = [...String(html).matchAll(/description__job-criteria-text[^>]*>([\s\S]*?)<\/span>/g)].map((m) => htmlToText(m[1])).filter(Boolean);
  const applicants = (String(html).match(/num-applicants__caption[^>]*>([\s\S]*?)<\//) || [])[1];
  if (!markup) return null;
  return { text: `${criteria.length ? `${criteria.join(' | ')}\n\n` : ''}${htmlToText(markup)}`, applicants: applicants ? htmlToText(applicants) : '' };
}

async function read(row) {
  if (row.body && validate.check(row.body).ok) return { ok: true, text: row.body, method: 'api' };
  try {
    if (row.source === 'LinkedIn') {
      const res = await request(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${row.native_id}`, { retries: 1 });
      const d = res.status === 200 ? linkedinDetail(res.text) : null;
      if (d) {
        const v = validate.check(d.text);
        return { ok: v.ok, text: d.text, reason: v.reason, method: 'linkedin', extra: { applicants: d.applicants } };
      }
      return { ok: false, reason: res.status === 429 ? 'rate_limited' : `http_${res.status}`, method: 'linkedin' };
    }
    if (row.source === 'Arbeitsagentur') {
      const enc = Buffer.from(String(row.native_id)).toString('base64');
      const res = await request(`https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v4/jobdetails/${enc}`, { headers: { 'x-api-key': 'jobboerse-jobsuche' }, json: true });
      const d = res.data || {};
      const text = [d.stellenangebotsTitel, d.arbeitgeber, htmlToText(d.stellenangebotsBeschreibung)].filter(Boolean).join('\n\n');
      const v = validate.check(text);
      if (v.ok || !d.externeUrl) return { ok: v.ok, text, reason: v.reason, method: 'ba-api' };
      row = { ...row, url: d.externeUrl };
    }
    if (!/^https?:\/\//.test(row.url || '')) return { ok: false, reason: 'no_link', method: 'none' };
    const res = await request(row.url, { retries: 1, timeout: 25000 });
    if (res.status === 404 || res.status === 410) return { ok: false, reason: 'ad_gone', method: 'http' };
    const posting = jobPostingFromHtml(res.text);
    const text = posting ? posting.text : mainText(res.text);
    const v = validate.check(text);
    return { ok: v.ok, text, reason: v.reason || (res.status >= 400 ? `http_${res.status}` : null), method: posting ? 'jobposting' : 'http', extra: posting || undefined };
  } catch (err) {
    return { ok: false, reason: 'error', error: String(err.message || err).slice(0, 200), method: 'error' };
  }
}

module.exports = { read, jobPostingFromHtml, linkedinDetail };
