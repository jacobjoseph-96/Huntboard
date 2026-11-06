// Turns an AI tool call into a short, plain-language progress line for the app.

const path = require('path');

const HUNT = {
  add: 'Adding jobs to the board',
  list: 'Looking at the board',
  show: 'Reading the ticket',
  move: 'Moving a ticket',
  set: 'Updating a ticket',
  note: 'Adding a note',
  interview: 'Adding an interview round',
  round: 'Updating the interview round',
  posting: 'Saving the job ad',
  files: 'Looking at the ticket files',
  inbox: 'Checking what needs attention',
  ask: 'Waiting for your answer',
  profile: 'Reading your profile',
  docs: 'Reading your documents',
  cv: 'Working on your CV',
  search: 'Searching job boards',
  ingest: 'Collecting the results',
  candidates: 'Looking at the candidates',
  boards: 'Choosing job boards',
  pdf: 'Making a PDF',
  factcheck: 'Checking the facts',
  export: 'Exporting',
  plan: 'Saving the search plan',
  letter: 'Making the cover letter',
  attachments: 'Putting the attachments together',
  email: 'Writing the e-mail draft',
  sent: 'Saving what was sent',
  needs: 'Adding to your "Needs you" list',
  decide: 'Writing down a decision',
  'followed-up': 'Recording the follow-up',
  'pdf-md': 'Making a PDF',
  interview: 'Adding an interview round',
};

function host(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return String(url || '').slice(0, 60);
  }
}

function base(p) {
  return p ? path.basename(String(p)) : '';
}

function describeCommand(cmd) {
  const c = String(cmd || '');
  const m = c.match(/hunt\.js\s+([\w-]+)(?:\s+(\w+))?(?:\s+(JOB-\d+))?/i);
  if (m) {
    let text = HUNT[m[1]] || `hunt ${m[1]}`;
    if (m[1] === 'profile' && /set|patch/.test(m[2] || '')) text = 'Updating your profile';
    if (m[1] === 'cv' && m[2] === 'set') text = 'Saving your structured CV';
    const key = (c.match(/JOB-\d+/i) || [])[0];
    return key ? `${text} (${key.toUpperCase()})` : text;
  }
  return `Running: ${c.replace(/\s+/g, ' ').slice(0, 70)}`;
}

function describe(name, input = {}) {
  const n = String(name || '').replace(/^mcp__[^_]+__/, '').toLowerCase();
  const i = input || {};
  if (['bash', 'powershell', 'run_command', 'run_shell_command', 'shell', 'command_execution', 'execute_command'].includes(n)) {
    return describeCommand(i.command || i.CommandLine || i.cmd || i.commandLine);
  }
  if (n.includes('navigate') || n === 'open_url' || n === 'browser_open') return `Opening ${host(i.url || i.Url)}`;
  if (n.includes('evaluate') || n.includes('get_dom') || n.includes('read_page')) return 'Reading the page';
  if (n.includes('snapshot') || n.includes('screenshot')) return 'Looking at the page';
  if (n.includes('click')) return 'Clicking on the page';
  if (n.includes('type') || n.includes('fill') || n.includes('input') || n.includes('select_option')) return 'Filling in the form';
  if (n.includes('wait')) return 'Waiting for the page';
  if (n.includes('file_upload')) return 'Uploading a document';
  if (['websearch', 'google_web_search', 'search_web', 'web_search'].includes(n)) return `Searching the web${i.query || i.Query ? `: ${String(i.query || i.Query).slice(0, 60)}` : ''}`;
  if (['webfetch', 'web_fetch', 'read_url_content', 'fetch'].includes(n)) return `Reading ${host(i.url || i.Url || i.prompt)}`;
  if (['read', 'read_file', 'view_file', 'read_many_files'].includes(n)) return `Reading ${base(i.file_path || i.path || i.AbsolutePath || i.absolute_path)}`;
  if (['write', 'write_file', 'write_to_file', 'create_file'].includes(n)) return `Writing ${base(i.file_path || i.path || i.TargetFile || i.target_file)}`;
  if (['edit', 'replace', 'multiedit', 'replace_file_content', 'edit_file'].includes(n)) return `Editing ${base(i.file_path || i.path || i.TargetFile)}`;
  if (['glob', 'grep', 'list_dir', 'list_directory', 'search_file_content', 'find_by_name', 'grep_search'].includes(n)) return 'Looking through files';
  if (n === 'skill') return `Using the ${i.skill || i.name || ''} skill`.replace(/\s+skill$/, ' skill');
  if (n === 'todowrite' || n === 'update_plan') return 'Planning the next steps';
  return `Using ${name}`;
}

module.exports = { describe, describeCommand };
