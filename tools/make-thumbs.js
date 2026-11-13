#!/usr/bin/env node
// Makes the small pictures of the CV designs that the Profile page shows (assets/cv-templates/<id>.png).
// Run it after changing a stylesheet in templates/cv/:  node tools/make-thumbs.js
// It uses the made-up sample person (templates/cv/sample.json), never the user's data.

const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-thumbs-'));
process.env.HUNTBOARD_WORKSPACE = path.join(tmp, 'workspace');

const paths = require('../lib/paths');
const render = require('../lib/render');
const { htmlToPng } = require('../lib/pdf');

const out = path.join(paths.ROOT, 'assets', 'cv-templates');
fs.mkdirSync(out, { recursive: true });
try {
  for (const t of render.templates().filter((x) => !x.own)) {
    const html = render.cvHtml(render.sampleCv(), { person: {}, about: {} }, { lang: 'en', template: t.id, photo: render.placeholderPhoto(), extras: { privacy: false } });
    const file = path.join(tmp, `${t.id}.html`);
    fs.writeFileSync(file, html);
    htmlToPng(file, path.join(out, `${t.id}.png`), { scale: 0.5 });
    console.log(`assets/cv-templates/${t.id}.png`);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
