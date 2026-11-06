// HTTP for job board APIs: browser-like headers, timeout, polite retries on 429 / 5xx.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const BROWSERLIKE = {
  'user-agent': UA,
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
  'accept-language': 'en;q=0.9,de;q=0.8,it;q=0.8,fr;q=0.7,es;q=0.7',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(url, { method = 'GET', headers = {}, body, timeout = 30000, retries = 2, json = false } = {}) {
  let last = { status: 0, text: '', error: '' };
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt) await sleep(attempt === 1 ? 3000 : 10000);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, {
        method,
        headers: { ...BROWSERLIKE, ...(body && typeof body !== 'string' ? { 'content-type': 'application/json' } : {}), ...headers },
        body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
        signal: ctrl.signal,
        redirect: 'follow',
      });
      const text = await res.text();
      last = { status: res.status, text, url: res.url, error: '' };
      if (res.status === 429 || res.status >= 500) continue;
      break;
    } catch (err) {
      last = { status: 0, text: '', error: err.name === 'AbortError' ? 'timeout' : String(err.message || err) };
    } finally {
      clearTimeout(timer);
    }
  }
  if (json) {
    try {
      last.data = JSON.parse(last.text);
    } catch {
      last.data = null;
    }
  }
  return last;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
function decodeEntities(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

// HTML → readable text with line breaks for blocks and list items.
function htmlToText(html) {
  return decodeEntities(String(html || '')
    .replace(/<(script|style|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|h[1-6]|li|ul|ol|tr|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = { request, htmlToText, decodeEntities, UA, sleep };
