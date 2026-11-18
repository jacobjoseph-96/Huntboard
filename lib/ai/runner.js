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
const routing = require('./routing');
const PROXY_SKILLS = ['search', 'plan-search', 'apply', 'tailor', 'cover-letter', 'follow-up'];

function platforms() {
  return JSON.parse(fs.readFileSync(path.join(paths.ROOT, 'agent', 'platforms.json'), 'utf8'));
}

function detectTools() {
  const p = platforms();
  return Object.entries(p.tools).map(([id, t]) => {
    const r = resolveTool(t);
    return { id, name: t.name, verified: Boolean(t.verified), installed: r.installed, runnable: Boolean(r.command), path: r.path, install: t.install, sign_in: t.sign_in, models: t.models || null, has_adapter: Boolean(ADAPTERS[id]) };
  });
}

// The AI tool's usage limit. A run that hits it waits for the reset and then continues (the same session when the
// tool supports it) instead of failing; while the limit lasts no other run of that tool starts.
const limitUntil = {}; // tool id -> ms
const LIMIT = { fallbackMs: 15 * 60000, slackMs: 60000, maxWaits: 3 }; // fallback: when the tool names no reset time
// A chat continues its session, but every message re-reads the whole history: start a fresh one each day and
// after CHAT_MAX_TURNS messages (the board, tickets and profile are on disk, nothing is lost).
const CHAT_MAX_TURNS = 15;
const today = () => new Date().toISOString().slice(0, 10);
function chatSession(settings, toolId) {
  const id = (settings.ai.chat_sessions || {})[toolId] || null;
  const meta = (settings.ai.chat_meta || {})[toolId];
  if (!id || !meta || meta.session !== id) return null; // an old session from before the rollover: start fresh
  return meta.day === today() && (meta.turns || 0) < CHAT_MAX_TURNS ? id : null;
}

const RESUME_PROMPT = 'The AI usage limit stopped you in the middle of this task. Continue exactly where you stopped and finish the task you were given.';
const limitActive = (tool) => ((limitUntil[tool] || 0) > Date.now() ? limitUntil[tool] : null);

function classifyError(text) {
  const s = String(text || '');
  if (/not (logged|signed) in|please (log|sign) in|login required|authenticat|unauthori[sz]ed|\b401\b|invalid api key|oauth/i.test(s)) return 'not_signed_in';
  if (/rate.?limit|quota|usage limit|session limit|weekly limit|hit your .{0,20}limit|limit reached|\b429\b|resource.?exhausted|credit balance|out of credits/i.test(s)) return 'limit';
  return null;
}

class Runner extends EventEmitter {
  // opts (for tests): { adapters, platforms, resolve }
  constructor(opts = {}) {
    super();
    this.opts = opts;
    this.queue = [];
    this.current = null;
    this.waiting = null; // { run, timer }: a run waiting for the usage limit to reset
    this.gateTimer = null; // { run, child, cancelled }
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
      if (r.status === 'running' || r.status === 'queued' || r.status === 'waiting_limit') {
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
      title: title || (kind === 'chat' || kind === 'task' ? String(message).replace(/\s+/g, ' ').slice(0, 80) : kind === 'test' ? 'Test the AI tool' : prompts.TASKS[skill] || skill),
      tool: settings.ai.tool,
      // The model for this kind of task (Settings → AI tool → Models): light, standard or strong.
      model: routing.modelFor(settings, settings.ai.tool, kind === 'skill' ? skill : kind),
      tier: routing.tierFor(settings, kind === 'skill' ? skill : kind),
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
    if (this.current || this.waiting || !this.queue.length) return;
    const next = this.get(this.queue[0]);
    // While the tool's usage limit lasts, queued work waits instead of failing one run after another.
    // A connection test and a chat message still go through: they answer at once.
    const gate = next && next.status === 'queued' && !['test', 'chat'].includes(next.kind) && limitActive(next.tool);
    if (gate) {
      if (!this.gateTimer) this.gateTimer = setTimeout(() => { this.gateTimer = null; this.pump(); }, gate - Date.now() + 500);
      return;
    }
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
    // After a usage-limit wait, a run that had already worked continues its own session.
    const resume = run.resume_session || null;
    const prompt = run.kind === 'test'
      ? 'Reply with exactly the word OK and nothing else. Do not use any tools.'
      : resume ? RESUME_PROMPT : `Read the file ${relPrompt} and do exactly what it says.`;
    const session = run.kind === 'chat' ? chatSession(settings, toolId) : resume;
    const prep = adapter.prepare ? adapter.prepare({ runDir: dir, platforms: pl, cwd: paths.ROOT, tier: run.tier }) : {};
    // Ticked before any tool was chosen: saved under '' and used until this tool has its own choice.
    const fa = settings.ai.full_access || {};
    const fullAccess = Boolean(toolId in fa ? fa[toolId] : fa['']);
    const workspace = paths.ws();
    const args = [...resolved.prefixArgs, ...adapter.args({ prompt, model: run.model, session, fullAccess, platforms: pl, workspace, ...prep })];

    const out = fs.openSync(path.join(dir, 'output.jsonl'), 'a');
    const errLog = fs.openSync(path.join(dir, 'stderr.log'), 'a');
    const child = spawn(resolved.command, args, {
      cwd: paths.ROOT,
      env: { ...process.env, HUNTBOARD_RUN_ID: run.id, HUNTBOARD_HEADLESS: '1', ENABLE_CLAUDEAI_MCP_SERVERS: 'false', HUNTBOARD_PROXY: run.proxy ? '1' : '', NO_COLOR: '1', FORCE_COLOR: '0' },
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
        } else if (e.type === 'limit') {
          this.current.limitHit = true;
          if (e.resets_at) this.current.limitResetsAt = e.resets_at;
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
        const kind = (cur.limitHit && 'limit') || classifyError(detail) || (res && res.denied && res.denied.length ? 'denied' : null);
        if (kind === 'limit') {
          const until = Math.max(Date.now(), cur.limitResetsAt || Date.now() + LIMIT.fallbackMs) + LIMIT.slackMs;
          limitUntil[run.tool] = Math.max(limitUntil[run.tool] || 0, until);
        }
        if (kind === 'limit' && !['chat', 'test'].includes(run.kind) && (run.limit_waits || 0) < LIMIT.maxWaits) {
          this.waitForLimit(run, cur.limitResetsAt, toolInfo.name);
          return;
        }
        const messages = {
          not_signed_in: `${toolInfo.name} is not signed in. ${adapter.signInHint || ''}`.trim(),
          limit: `${toolInfo.name} says its usage limit is reached${run.model ? ` (model ${run.model})` : ''}. Wait a while, or in Settings → AI tool → Models give the ${run.tier || 'standard'} tasks a lighter model, or use another AI tool.`,
          denied: `${toolInfo.name} was not allowed to do: ${(res && res.denied || []).join(', ')}. You can allow it in Settings → AI tool → "Let the AI work without asking".`,
        };
        this.finish(run, { ok: false, text, error: messages[kind] || `The AI stopped with an error (exit code ${code}). ${detail.split('\n').filter(Boolean).slice(-3).join(' ').slice(0, 500)}`, error_kind: kind, denied: res && res.denied });
      }
    });
  }

  // The run hit the usage limit: it waits (status waiting_limit) and starts again after the reset, continuing its own
  // session when it had already done some work.
  waitForLimit(run, resetsAt, toolName) {
    const until = Math.max(limitUntil[run.tool] || 0, Math.max(Date.now(), resetsAt || Date.now() + LIMIT.fallbackMs) + LIMIT.slackMs);
    run.status = 'waiting_limit';
    run.limit_waits = (run.limit_waits || 0) + 1;
    run.resume_at = new Date(until).toISOString();
    run.error = `${toolName} says its usage limit is reached. This task waits and continues at ${new Date(until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`;
    run.error_kind = 'limit';
    if (run.session_id && run.steps.length) run.resume_session = run.session_id;
    for (const a of asks.listPending()) if (a.run_id === run.id) asks.cancel(a.id, 'cancelled');
    if (this.current && this.current.run.id === run.id) this.current = null;
    const timer = setTimeout(() => {
      if (!this.waiting || this.waiting.run.id !== run.id) return;
      this.waiting = null;
      run.status = 'queued';
      run.error = null;
      run.error_kind = null;
      this.save(run);
      this.queue.unshift(run.id);
      this.pump();
    }, until - Date.now());
    this.waiting = { run, timer };
    this.save(run);
    this.emit('waiting', run);
  }

  finish(run, { ok, text = '', error = null, error_kind = null, cancelled = false, denied = [] }) {
    run.status = ok ? 'done' : cancelled ? 'cancelled' : 'failed';
    run.cancel_reason = cancelled || undefined; // user: the Stop button; timeout: the time limit
    run.result_text = String(text || '').trim().slice(0, 20000);
    run.error = cancelled ? (cancelled === 'timeout' ? `Stopped after ${MAX_MINUTES} minutes.` : 'Cancelled.') : error;
    run.error_kind = error_kind;
    run.denied = denied && denied.length ? denied : undefined;
    run.finished_at = nowIso();
    if (run.kind === 'chat' && run.session_id && run.tool) {
      const s = profileLib.loadSettings();
      const meta = (s.ai.chat_meta || {})[run.tool] || {};
      const same = meta.session === run.session_id;
      profileLib.saveSettings({ ai: {
        chat_sessions: { ...(s.ai.chat_sessions || {}), [run.tool]: run.session_id },
        chat_meta: { ...(s.ai.chat_meta || {}), [run.tool]: { session: run.session_id, day: same ? meta.day : today(), turns: same ? (meta.turns || 0) + 1 : 1 } },
      } });
    }
    for (const a of asks.listPending()) if (a.run_id === run.id) asks.cancel(a.id, 'cancelled');
    this.save(run);
    this.emit('done', run);
    if (this.current && this.current.run.id === run.id) this.current = null;
    setImmediate(() => this.pump());
  }

  cancel(id, reason = 'user') {
    if (this.waiting && this.waiting.run.id === id) {
      clearTimeout(this.waiting.timer);
      const { run } = this.waiting;
      this.waiting = null;
      this.finish(run, { ok: false, cancelled: reason });
      return true;
    }
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
    return this.current ? this.current.run.id : this.waiting ? this.waiting.run.id : null;
  }

  // Running, waiting for the usage limit, and queued runs, in that order.
  active() {
    const out = this.queue.map((id) => this.get(id)).filter(Boolean);
    if (this.waiting) out.unshift(this.waiting.run);
    if (this.current) out.unshift(this.current.run);
    return out;
  }
}

module.exports = { Runner, detectTools, classifyError, limitUntil, limitActive, LIMIT };
