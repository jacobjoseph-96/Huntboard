// Static checks of the app pages (no browser): every helper a page uses is imported, no inline handlers (CSP).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./helpers');

const DIR = path.join(ROOT, 'app', 'public', 'pages');
const APP_EXPORTS = (() => {
  const src = fs.readFileSync(path.join(ROOT, 'app', 'public', 'app.js'), 'utf8');
  return new Set([...src.matchAll(/export (?:async )?(?:function|const|class) ([\w$]+)/g)].map((m) => m[1]));
})();

for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.js'))) {
  test(`page ${file}: imports what it uses`, () => {
    const src = fs.readFileSync(path.join(DIR, file), 'utf8');
    const imp = (src.match(/import \{([^}]*)\} from '\.\.\/app\.js'/) || [])[1] || '';
    const names = new Set(imp.split(',').map((s) => s.trim()).filter(Boolean));
    for (const n of names) assert.ok(APP_EXPORTS.has(n), `${file} imports "${n}", which app.js does not export`);
    const body = src.replace(/import[^;]+;/g, '');
    if (/(^|[^\w$])\$\$\(/.test(body)) assert.ok(names.has('$$') || /export \{[^}]*\$\$/.test(src), `${file} uses $$() without importing it`);
    if (/(^|[^\w$])\$\(/.test(body)) assert.ok(names.has('$'), `${file} uses $() without importing it`);
    for (const helper of ['html', 'raw', 'md', 'api', 'toast', 'modal', 'startRun', 'ago', 'when']) {
      if (new RegExp(`(^|[^\\w.])${helper}[(\`]`).test(body) && !/function /.test(`function ${helper}`)) {
        assert.ok(names.has(helper) || new RegExp(`function ${helper}\\b|const ${helper}\\b`).test(src), `${file} uses ${helper} without importing it`);
      }
    }
    assert.doesNotMatch(src, /\son(click|change|submit|load|input)=/i, `${file} has an inline event handler (blocked by the page's security policy)`);
  });
}
