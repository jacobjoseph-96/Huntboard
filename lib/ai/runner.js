// Runs the user's AI tool in the background, one task at a time, and reports progress.
// Each run lives in workspace/runs/<id>/: run.json, prompt.md, output.jsonl (raw tool output), stderr.log.

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { EventEmitter } = require('events');
const paths = require('../paths');
const { ensureDir, readJson, writeJson, writeAtomic, newId, nowIso } = require('../fsx');
const profileLib = require('../profile');
const asks = require('./ask');
const prompts = require('./prompts');
const { ADAPTERS } = require('./adapters');
const { resolveTool, IS_WIN } = require('./detect');

const MAX_MINUTES = 120;
const MAX_STEPS = 400;
// In fully automatic mode these tasks run as the user's stand-in.
const PROXY_SKILLS = ['search', 'plan-search', 'apply', 'tailor', 'cover-letter', 'follow-up'];

function platforms() {
  return JSON.parse(fs.readFileSync(path.join(paths.ROOT, 'agent', 'platforms.json'), 'utf8'));
}

function detectTools() {
  const p = platforms();
  return Object.entries(p.tools).map(([id, t]) => {
    const r = resolveTool(t);
    return { id, name: t.name, verified: Boolean(t.verified), installed: r.installed, runnable: Boolean(r.command), path: r.path, install: t.install, sign_in: t.sign_in, has_adapter: Boolean(ADAPTERS[id]) };
  });
}

function classifyError(text) {
  const s = String(text || '');
  if (/not (logged|signed) in|please (log|sign) in|login required|authenticat|unauthori[sz]ed|\b401\b|invalid api key|oauth/i.test(s)) return 'not_signed_in';
  if (/rate.?limit|quota|usage limit|limit reached|\b429\b|resource.?exhausted|credit balance|out of credits/i.test(s)) return 'limit';
  return null;
}

class Runner extends EventEmitter {
  // opts (for tests): { adapters, platforms, resolve }
  constructor(opts = {}) {
    super();
    this.opts = opts;
    this.queue = [];
    this.current = null; // { run, child, cancelled }
    this.recover();
  }

  dir(id) {
    return path.join(paths.runsDir(), id.replace(/[^\w-]/g, ''));
  }

  save(run) {
    run.updated_at = nowIso();
    writeJson(path.join(this.dir(run.id), 'run.json'), run);
    this.emit('run', run);
  }

  get(id) {
    return readJson(path.join(this.dir(id), 'run.json')) || null;
  }

  list(limit = 40) {
    const base = paths.runsDir();
    if (!fs.existsSync(base)) return [];
    return fs.readdirSync(base).filter((d) => d.startsWith('run-')).sort().reverse().slice(0, limit)
      .map((d) => readJson(path.join(base, d, 'run.json')))
      .filter(Boolean);
  }

  // Runs left "running" by a previous app session are marked interrupted.
  recover() {
    for (const r of this.list(100)) {
      if (r.status === 'running' || r.status === 'queued') {
        r.status = 'interrupted';
        r.error = 'The app was closed while this was running.';
        r.finished_at = r.finished_at || nowIso();
        writeJson(path.join(this.dir(r.id), 'run.json'), r);
      }
    }
  }

  // proxy: fully automatic run; questions wait briefly for the user, then the AI decides as their stand-in.
  enqueue({ kind = 'skill', skill = null, ticket = null, target = null, message = '', context = null, args = null, title = '', proxy = null }) {
    if (kind === 'skill' && !prompts.skillExists(skill)) {
      throw Object.assign(new Error(`"${skill}" is not available yet in this version of Huntboard.`), { status: 400 });
    }
    const settings = profileLib.loadSettings();
    const mode = profileLib.loadProfile().applying.mode;
    const run = {
      id: newId('run-'),
      kind,
      skill,
      ticket,
      target,
      message: String(message || '').slice(0, 20000),
      context,
      args,
      title: title || (kind === 'chat' ? String(message).slice(0, 80) : kind === 'test' ? 'Test the AI tool' : prompts.TASKS[skill] || skill),
      tool: settings.ai.tool,
      model: settings.ai.model,
      proxy: proxy == null ? kind === 'skill' && PROXY_SKILLS.includes(skill) && mode === 'full_auto' : Boolean(proxy),
      status: 'queued',
      created_at: nowIso(),
      started_at: null,
      finished_at: null,
      session_id: null,
      steps: [],
      warnings: [],
      result_text: '',
      error: null,
      error_kind: null,
    };
    ensureDir(this.dir(run.id));
    this.save(run);
    this.queue.push(run.id);
    setImmediate(() => this.pump());
    return run;
  }

  pump() {
    if (this.current || !this.queue.length) return;
    const id = this.queue.shift();
    const run = this.get(id);
    if (!run || run.status !== 'queued') return this.pump();
    try {
      this.start(run);
    } catch (err) {
      this.finish(run, { ok: false, error: err.message, error_kind: err.kind || null });
    }
  }

  start(run) {
    const settings = profileLib.loadSettings();
    const toolId = run.tool;
    const pl = this.opts.platforms || platforms();
    const toolInfo = pl.tools[toolId];
    const adapter = (this.opts.adapters || ADAPTERS)[toolId];
    if (!toolId || !toolInfo || !adapter) {
      throw Object.assign(new Error('No AI tool is chosen yet. Open Settings → AI tool and pick one.'), { kind: 'no_tool' });
    }
    const resolved = (this.opts.resolve || resolveTool)(toolInfo);
    if (!resolved.command) {
      throw Object.assign(new Error(`${toolInfo.name} is not installed on this computer (or cannot be started). Install it, or pick another AI tool in Settings.`), { kind: 'not_installed' });
    }
    const dir = this.dir(run.id);
    const profile = profileLib.loadProfile();
    writeAtomic(path.join(dir, 'prompt.md'), prompts.build(run, profile));
    ensureDir(paths.ws('tmp'));
    const relPrompt = path.relative(paths.ROOT, path.join(dir, 'prompt.md')).split(path.sep).join('/');
    const prompt = run.kind === 'test'
      ? 'Reply with exactly the word OK and nothing else. Do not use any tools.'
      : `Read the file ${relPrompt} and do exactly what it says.`;
    const session = run.kind === 'chat' ? (settings.ai.chat_sessions || {})[toolId] || null : null;
    const prep = adapter.prepare ? adapter.prepare({ runDir: dir, platforms: pl }) : {};
    const fullAccess = Boolean((settings.ai.full_access || {})[toolId]);
    const workspace = paths.ws();
    const args = [...resolved.prefixArgs, ...adapter.args({ prompt, model: run.model || settings.ai.model, session, fullAccess, platforms: pl, workspace, ...prep })];

    const out = fs.openSync(path.join(dir, 'output.jsonl'), 'a');
    const errLog = fs.openSync(path.join(dir, 'stderr.log'), 'a');
    const child = spawn(resolved.command, args, {
      cwd: paths.ROOT,
      env: { ...process.env, HUNTBOARD_RUN_ID: run.id, HUNTBOARD_HEADLESS: '1', HUNTBOARD_PROXY: run.proxy ? '1' : '', NO_COLOR: '1', FORCE_COLOR: '0' },
      windowsHide: true,
      detached: !IS_WIN,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    run.status = 'running';
    run.started_at = nowIso();
    run.tool_name = toolInfo.name;
    this.current = { run, child, cancelled: false, st: {}, stderr: '', lastText: '' };
    this.save(run);

    const st = this.current.st;
    let buf = '';
    const onLine = (lineText) => {
      if (!lineText.trim()) return;
      fs.writeSync(out, lineText + '\n');
      let obj = null;
      try {
        obj = JSON.parse(lineText);
      } catch {
        obj = null;
      }
      let events = [];
      try {
        events = adapter.parse(obj, st, lineText) || [];
      } catch {
        events = [];
      }
      let changed = false;
      for (const e of events) {
        if (e.type === 'session') {
          run.session_id = e.id;
          changed = true;
        } else if (e.type === 'step') {
          const last = run.steps[run.steps.length - 1];
          if (!last || last.text !== e.text) {
            run.steps.push({ at: nowIso(), text: e.text });
            if (run.steps.length > MAX_STEPS) run.steps.splice(1, run.steps.length - MAX_STEPS);
            changed = true;
          }
        } else if (e.type === 'text') {
          this.current.lastText = e.text;
        } else if (e.type === 'warning') {
          run.warnings.push(String(e.text).slice(0, 400));
          if (run.warnings.length > 30) run.warnings.shift();
          changed = true;
        } else if (e.type === 'result') {
          this.current.result = e;
        }
      }
      if (changed) this.save(run);
    };
    child.stdout.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        onLine(buf.slice(0, i).replace(/\r$/, ''));
        buf = buf.slice(i + 1);
      }
    });
    child.stderr.on('data', (d) => {
      fs.writeSync(errLog, d);
      this.current.stderr = (this.current.stderr + d.toString('utf8')).slice(-8000);
    });
    const timer = setTimeout(() => this.cancel(run.id, 'timeout'), MAX_MINUTES * 60000);
    child.on('error', (err) => {
      this.current.spawnError = err.message;
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (buf.trim()) onLine(buf);
      fs.closeSync(out);
      fs.closeSync(errLog);
      const cur = this.current;
      let res = cur.result || (adapter.finish ? adapter.finish(st, code) : null);
      const text = (res && res.text) || cur.lastText || st.text || '';
      if (cur.cancelled) {
        this.finish(run, { ok: false, cancelled: cur.cancelled, text });
      } else if (res && res.ok) {
        this.finish(run, { ok: true, text, denied: res.denied });
      } else {
        const detail = [cur.spawnError, cur.stderr, ...(run.warnings || []), res && res.text].filter(Boolean).join('\n');
        const kind = classifyError(detail) || (res && res.denied && res.denied.length ? 'denied' : null);
        const messages = {
          not_signed_in: `${toolInfo.name} is not signed in. ${adapter.signInHint || ''}`.trim(),
          limit: `${toolInfo.name} says its usage limit is reached. Wait a while, or pick another model or AI tool in Settings.`,
          denied: `${toolInfo.name} was not allowed to do: ${(res && res.denied || []).join(', ')}. You can allow it in Settings → AI tool → "Let the AI work without asking".`,
        };
        this.finish(run, { ok: false, text, error: messages[kind] || `The AI stopped with an error (exit code ${code}). ${detail.split('\n').filter(Boolean).slice(-3).join(' ').slice(0, 500)}`, error_kind: kind, denied: res && res.denied });
      }
    });
  }

  finish(run, { ok, text = '', error = null, error_kind = null, cancelled = false, denied = [] }) {
    run.status = ok ? 'done' : cancelled ? 'cancelled' : 'failed';
    run.result_text = String(text || '').trim().slice(0, 20000);
    run.error = cancelled ? (cancelled === 'timeout' ? `Stopped after ${MAX_MINUTES} minutes.` : 'Cancelled.') : error;
    run.error_kind = error_kind;
    run.denied = denied && denied.length ? denied : undefined;
    run.finished_at = nowIso();
    if (run.kind === 'chat' && run.session_id && run.tool) {
      const s = profileLib.loadSettings();
      profileLib.saveSettings({ ai: { chat_sessions: { ...(s.ai.chat_sessions || {}), [run.tool]: run.session_id } } });
    }
    for (const a of asks.listPending()) if (a.run_id === run.id) asks.cancel(a.id, 'cancelled');
    this.save(run);
    this.emit('done', run);
    if (this.current && this.current.run.id === run.id) this.current = null;
    setImmediate(() => this.pump());
  }

  cancel(id, reason = 'user') {
    const qi = this.queue.indexOf(id);
    if (qi >= 0) {
      this.queue.splice(qi, 1);
      const run = this.get(id);
      if (run) this.finish(run, { ok: false, cancelled: reason });
      return true;
    }
    if (!this.current || this.current.run.id !== id) return false;
    this.current.cancelled = reason;
    const pid = this.current.child.pid;
    try {
      if (IS_WIN) spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
      else process.kill(-pid, 'SIGTERM');
    } catch {
      try {
        this.current.child.kill();
      } catch {
        // already gone
      }
    }
    return true;
  }

  resetChat() {
    const tool = profileLib.loadSettings().ai.tool;
    const s = profileLib.loadSettings();
    profileLib.saveSettings({ ai: { chat_sessions: { ...(s.ai.chat_sessions || {}), [tool]: null } } });
  }

  busy() {
    return this.current ? this.current.run.id : null;
  }
}

module.exports = { Runner, detectTools, classifyError };
