// An e-mail draft (.eml) with attachments. Opening the file shows it as an unsent draft in Outlook,
// Thunderbird or Apple Mail, so the user checks it and presses Send. Huntboard never sends e-mail itself.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MIME = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.txt': 'text/plain', '.html': 'text/html' };

function encodeHeader(s) {
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
}

function wrap64(buf) {
  return buf.toString('base64').replace(/.{1,76}/g, '$&\r\n');
}

function build({ from = '', to = '', subject = '', body = '', attachments = [] }) {
  const boundary = `huntboard-${crypto.randomBytes(8).toString('hex')}`;
  const lines = [
    `From: ${encodeHeader(from)}`,
    `To: ${encodeHeader(to)}`,
    `Subject: ${encodeHeader(subject)}`,
    'X-Unsent: 1',
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="utf-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap64(Buffer.from(body.replace(/\r?\n/g, '\r\n'), 'utf8')),
  ];
  for (const file of attachments) {
    const name = path.basename(file);
    lines.push(`--${boundary}`,
      `Content-Type: ${MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'}; name="${encodeHeader(name)}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${encodeHeader(name)}"`,
      '',
      wrap64(fs.readFileSync(file)));
  }
  lines.push(`--${boundary}--`, '');
  return lines.join('\r\n');
}

module.exports = { build };
