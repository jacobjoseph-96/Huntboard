// Spreadsheet export of all tickets, and import of the old one-sheet job list
// (columns: Nr, Job Name, Company, Job Description, Job Requirements, Salary, Location, Job Type,
//  Category, Date Posted, Job Link, Fit for Me, Status).

const fs = require('fs');
const ExcelJS = require('exceljs');
const store = require('./store');

const EXPORT_COLUMNS = [
  ['key', 'Key', 9], ['status', 'Status', 12], ['title', 'Job', 34], ['company', 'Company', 28], ['location', 'Location', 22],
  ['job_type', 'Type', 14], ['salary', 'Salary', 18], ['fit', 'Fit', 8], ['source', 'Source', 14], ['posted', 'Posted', 12],
  ['applied_at', 'Applied', 12], ['stage', 'Interview stage', 20], ['link', 'Link', 40],
];

async function exportXlsx(file) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Jobs');
  ws.columns = EXPORT_COLUMNS.map(([key, header, width]) => ({ key, header, width }));
  for (const t of store.listTickets()) {
    ws.addRow({
      ...t,
      status: store.STATUS_LABELS[t.status] + (t.resolution ? ` (${t.resolution})` : ''),
      fit: t.fit && t.fit.score != null ? t.fit.score : '',
      applied_at: (t.applied_at || '').slice(0, 10),
      stage: t.interview && t.interview.stage ? store.stageLabel(t.interview.stage) : '',
    });
  }
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: 'A1', to: { row: 1, column: EXPORT_COLUMNS.length } };
  await wb.xlsx.writeFile(file);
  return ws.rowCount - 1;
}

function cellText(cell) {
  const v = cell.value;
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((r) => r.text).join('');
    if (v.hyperlink) return v.hyperlink;
    if (v.text != null) return String(v.text);
    if (v.result != null) return String(v.result);
    return '';
  }
  return String(v);
}

const LEGACY_STATUS = { new: 'found', applied: 'applied', interview: 'interview', rejected: 'closed' };

async function importLegacyXlsx(file) {
  if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  const header = {};
  ws.getRow(1).eachCell((c, i) => { header[cellText(c).trim().toLowerCase()] = i; });
  const col = (row, name) => (header[name] ? cellText(row.getCell(header[name])).trim() : '');
  const jobs = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const linkCell = header['job link'] ? row.getCell(header['job link']) : null;
    const link = linkCell && linkCell.hyperlink ? linkCell.hyperlink : col(row, 'job link');
    const title = col(row, 'job name');
    if (!title && !link) continue;
    const status = LEGACY_STATUS[col(row, 'status').toLowerCase()] || 'found';
    const fitText = col(row, 'fit for me');
    jobs.push({
      title,
      company: col(row, 'company'),
      summary: col(row, 'job description'),
      requirements: col(row, 'job requirements'),
      salary: col(row, 'salary'),
      location: col(row, 'location'),
      job_type: col(row, 'job type'),
      category: col(row, 'category'),
      posted: col(row, 'date posted'),
      link,
      source: /linkedin/i.test(link) ? 'LinkedIn' : /indeed/i.test(link) ? 'Indeed' : '',
      status,
      resolution: status === 'closed' ? 'rejected' : undefined,
      fit: fitText ? { score: /^very good/i.test(fitText) ? 85 : /^good/i.test(fitText) ? 70 : /^weak/i.test(fitText) ? 40 : null, verdict: fitText } : null,
    });
  }
  return store.addTickets(jobs, { by: 'user' });
}

module.exports = { exportXlsx, importLegacyXlsx };
