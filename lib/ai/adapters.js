// How to run each AI tool in the background and read its progress.
// Every adapter gets only constant arguments: the task itself is in a prompt file, so nothing the user
// typed ever reaches a command line.
//
// Events returned by parse(): {type:'session', id} {type:'step', text} {type:'text', text}
//                             {type:'warning', text} {type:'result', ok, text, denied}
//                             {type:'limit', resets_at} (usage limit hit; resets_at in ms or null)

const fs = require('fs');
const path = require('path');
const { describe } = require('./steps');

const SAFE_MODEL = /^[\w.:/@()+ -]{1,80}$/;
const SAFE_ID = /^[\w-]{4,80}$/;

function modelArgs(flag, model) {
  return model && SAFE_MODEL.test(model) ? [flag, model] : [];
}

function sessionArgs(flag, session) {
  return session && SAFE_ID.test(session) ? [flag, session] : [];
}

function huntAllow(platforms) {
  return platforms.allow.commands;
}

// ---- Claude Code (verified) -------------------------------------------------------------
// Token cost: a run loads only the MCP servers of the folder it runs in (no global ones, no claude.ai connectors),
// the browser sends no page snapshot after every click (the agent asks for one when it needs it), no plugins,
// and the effort follows the task's tier.
const EFFORT = { light: 'low', standard: 'medium', strong: 'high' };
const UNUSED_TOOLS = ['Artifact', 'ArtifactComments', 'ArtifactData', 'CronCreate', 'CronDelete', 'CronList', 'DesignSync',
  'EnterWorktree', 'ExitWorktree', 'NotebookEdit', 'PushNotification', 'RemoteTrigger', 'ReportFindings', 'ScheduleWakeup'];

function leanMcpConfig(cwd, runDir) {
  let servers = {};
  try {
    servers = JSON.parse(fs.readFileSync(path.join(cwd, '.mcp.json'), 'utf8')).mcpServers || {};
  } catch {
    return null;
  }
  for (const s of Object.values(servers)) {
    const a = Array.isArray(s.args) ? s.args : [];
    if (!a.some((x) => /@playwright\/mcp/.test(String(x)))) continue;
    if (!a.includes('--snapshot-mode')) a.push('--snapshot-mode', 'none');
    if (!a.includes('--console-level')) a.push('--console-level', 'error');
    s.args = a;
  }
  const file = path.join(runDir, 'mcp.json');
  fs.writeFileSync(file, JSON.stringify({ mcpServers: servers }, null, 2));
  return file;
}

const claude = {
  id: 'claude',
  prepare({ runDir, cwd, tier }) {
    const settingsFile = path.join(runDir, 'claude_settings.json');
    fs.writeFileSync(settingsFile, JSON.stringify({ enabledPlugins: { 'dart-flutter@dart-flutter': false, 'obsidian@obsidian-skills': false } }, null, 2));
    return { mcpConfig: cwd ? leanMcpConfig(cwd, runDir) : null, effort: EFFORT[tier] || 'medium', settingsFile };
  },
  args({ prompt, model, session, fullAccess, platforms, workspace, mcpConfig, effort, settingsFile }) {
    const allowed = [
      // Claude Code uses Bash on macOS/Linux and its PowerShell tool on Windows.
      ...huntAllow(platforms).flatMap((c) => [`Bash(${c} *)`, `PowerShell(${c} *)`]),
      'mcp__playwright', 'WebSearch', 'WebFetch', 'Read', 'Glob', 'Grep', 'Skill', 'TodoWrite',
    ];
    return [
      '-p', prompt,
      '--output-format', 'stream-json', '--verbose',
      ...(workspace ? ['--add-dir', workspace] : []),
      ...(fullAccess ? ['--permission-mode', 'bypassPermissions'] : ['--permission-mode', 'acceptEdits', '--permission-prompts', 'none', '--allowedTools', ...allowed]),
      ...modelArgs('--model', model),
      ...sessionArgs('--resume', session),
      ...(mcpConfig ? ['--strict-mcp-config', '--mcp-config', mcpConfig] : []),
      ...(effort ? ['--effort', effort] : []),
      ...(settingsFile ? ['--settings', settingsFile] : []),
      // Tools and skill listings a Huntboard task never uses cost tokens on every turn. Prompts name the skill
      // file to read (agent/skills/<name>/SKILL.md), so the skill listing is not needed.
      '--disable-slash-commands',
      '--disallowedTools', ...UNUSED_TOOLS,
    ];
  },
  parse(o, st) {
    if (!o) return [];
    const ev = [];
    if (o.session_id && o.session_id !== st.session) {
      st.session = o.session_id;
      ev.push({ type: 'session', id: o.session_id });
    }
    if (o.type === 'assistant' && o.message && Array.isArray(o.message.content)) {
      for (const c of o.message.content) {
        if (c.type === 'text' && c.text) ev.push({ type: 'text', text: c.text });
        if (c.type === 'tool_use') ev.push({ type: 'step', text: describe(c.name, c.input), tool: c.name });
      }
    }
    // The usage limit: Claude reports it before the result, with the time it resets (epoch seconds).
    if (o.type === 'rate_limit_event' && o.rate_limit_info && o.rate_limit_info.status === 'rejected') {
      ev.push({ type: 'limit', resets_at: Number(o.rate_limit_info.resetsAt) * 1000 || null });
    }
    if (o.type === 'result') {
      if (o.is_error && o.api_error_status === 429) ev.push({ type: 'limit', resets_at: null });
      const denied = (o.permission_denials || []).map((d) => d.tool_name || d.tool || 'a tool');
      ev.push({ type: 'result', ok: !o.is_error && o.subtype === 'success', text: o.result || '', denied });
    }
    return ev;
  },
  signInHint: 'Open a terminal in the Huntboard folder, type "claude" and sign in once.',
};

// ---- Antigravity CLI (verified) -----------------------------------------------------------
const antigravity = {
  id: 'antigravity',
  prepare({ runDir, platforms }) {
    // Session-only settings: allow the hunt tool without prompts (headless mode cannot prompt).
    // Rule tokens are matched word by word; a trailing "*" token allows any arguments.
    const allow = huntAllow(platforms).map((c) => `command(${c} *)`);
    const file = path.join(runDir, 'agy_settings.json');
    fs.writeFileSync(file, JSON.stringify({ permissions: { allow } }, null, 2));
    return { settingsFile: file };
  },
  args({ prompt, model, session, fullAccess, settingsFile }) {
    return [
      '-p', prompt,
      '--output-format', 'stream-json',
      ...(fullAccess ? ['--dangerously-skip-permissions'] : ['--mode', 'accept-edits', '--settings', settingsFile]),
      ...modelArgs('--model', model),
      ...sessionArgs('--conversation', session),
    ];
  },
  parse(o, st, raw) {
    const ev = [];
    if (!o) {
      if (/^jetski:|permission/i.test(raw)) ev.push({ type: 'warning', text: raw.replace(/^jetski:\s*/, '') });
      return ev;
    }
    const id = o.conversation_id || (o.step_update && o.step_update.conversation_id) || (o.result && o.result.conversation_id);
    if (id && id !== st.session) {
      st.session = id;
      ev.push({ type: 'session', id });
    }
    const s = o.step_update;
    if (s && s.step_type === 'tool' && s.state === 'ACTIVE') ev.push({ type: 'step', text: describe(s.tool_name, s.tool_info && s.tool_info.parameters), tool: s.tool_name });
    if (s && s.step_type === 'tool' && s.state === 'ERROR' && s.tool_info && s.tool_info.error) {
      ev.push({ type: 'warning', text: String(s.tool_info.error.message || '').split('\n')[0].slice(0, 300) });
    }
    if (s && s.step_type === 'agent_response' && s.text_delta) {
      st.text = (st.text || '') + s.text_delta;
    }
    if (o.event === 'result' && o.result) {
      const denied = (o.result.denied_actions || []).map((d) => d.display_name || d.action);
      ev.push({ type: 'result', ok: o.result.status === 'SUCCESS' && !(denied.length && !o.result.response), text: o.result.response || st.text || '', denied });
    }
    return ev;
  },
  signInHint: 'Open a terminal in the Huntboard folder, type "agy" and sign in with your Google account once.',
};

// ---- Gemini CLI (unverified) ---------------------------------------------------------------
const gemini = {
  id: 'gemini',
  args({ prompt, model, session, fullAccess, platforms }) {
    return [
      '-p', prompt,
      '--output-format', 'stream-json',
      ...(fullAccess ? ['--approval-mode', 'yolo'] : ['--approval-mode', 'auto_edit', '--allowed-tools', ...huntAllow(platforms).map((c) => `run_shell_command(${c})`)]),
      ...modelArgs('--model', model),
      ...sessionArgs('--resume', session),
    ];
  },
  parse(o, st) {
    if (!o) return [];
    const ev = [];
    if (o.session_id && o.session_id !== st.session) {
      st.session = o.session_id;
      ev.push({ type: 'session', id: o.session_id });
    }
    if (o.type === 'tool_use') ev.push({ type: 'step', text: describe(o.tool_name, o.parameters), tool: o.tool_name });
    if (o.type === 'message' && o.role === 'assistant' && o.content) st.text = (st.text || '') + o.content;
    if (o.type === 'error') ev.push({ type: 'warning', text: o.message || JSON.stringify(o).slice(0, 200) });
    if (o.type === 'result') ev.push({ type: 'result', ok: o.status !== 'error', text: st.text || '', denied: [] });
    return ev;
  },
  signInHint: 'Open a terminal in the Huntboard folder, type "gemini" and sign in once.',
};

// ---- Codex CLI (unverified) ----------------------------------------------------------------
const codex = {
  id: 'codex',
  args({ prompt, model, session, fullAccess }) {
    const base = session && SAFE_ID.test(session) ? ['exec', 'resume', session] : ['exec'];
    return [
      ...base, '--json',
      ...(fullAccess ? ['--dangerously-bypass-approvals-and-sandbox'] : ['--full-auto']),
      ...modelArgs('--model', model),
      prompt,
    ];
  },
  parse(o, st) {
    if (!o) return [];
    const ev = [];
    if (o.type === 'thread.started' && o.thread_id) {
      st.session = o.thread_id;
      ev.push({ type: 'session', id: o.thread_id });
    }
    const it = o.item || {};
    if (o.type === 'item.started' && it.type === 'command_execution') ev.push({ type: 'step', text: describe('command_execution', { command: it.command }) });
    if (o.type === 'item.started' && it.type === 'mcp_tool_call') ev.push({ type: 'step', text: describe(it.tool, it.arguments) });
    if (o.type === 'item.started' && it.type === 'web_search') ev.push({ type: 'step', text: describe('web_search', { query: it.query }) });
    if (o.type === 'item.completed' && it.type === 'agent_message') st.text = it.text || st.text;
    if (o.type === 'turn.completed') ev.push({ type: 'result', ok: true, text: st.text || '', denied: [] });
    if (o.type === 'turn.failed' || o.type === 'error') ev.push({ type: 'result', ok: false, text: (o.error && o.error.message) || o.message || 'failed', denied: [] });
    return ev;
  },
  signInHint: 'Open a terminal, type "codex login" and sign in once.',
};

// ---- OpenCode (unverified) -------------------------------------------------------------------
const opencode = {
  id: 'opencode',
  args({ prompt, model, session }) {
    return ['run', '--format', 'json', ...modelArgs('--model', model), ...sessionArgs('--session', session), prompt];
  },
  parse(o, st) {
    if (!o) return [];
    const ev = [];
    const sid = o.sessionID || (o.part && o.part.sessionID);
    if (sid && sid !== st.session) {
      st.session = sid;
      ev.push({ type: 'session', id: sid });
    }
    const p = o.part || {};
    if (o.type === 'tool_use' || p.type === 'tool') ev.push({ type: 'step', text: describe(p.tool, p.state && p.state.input) });
    if (o.type === 'text' && p.text) st.text = (st.text || '') + p.text;
    if (o.type === 'error') ev.push({ type: 'warning', text: (o.error && (o.error.message || o.error.name)) || 'error' });
    return ev;
  },
  finish(st, code) {
    return { type: 'result', ok: code === 0, text: st.text || '', denied: [] };
  },
  signInHint: 'Open a terminal, type "opencode auth login" and choose your provider (or a local model) once.',
};

// ---- GitHub Copilot CLI (unverified, plain text output) ----------------------------------
const copilot = {
  id: 'copilot',
  args({ prompt, model, fullAccess, platforms }) {
    return ['-p', prompt, ...(fullAccess ? ['--allow-all-tools'] : huntAllow(platforms).slice(0, 1).flatMap((c) => ['--allow-tool', `shell(${c.split(' ')[0]})`])), ...modelArgs('--model', model)];
  },
  parse(o, st, raw) {
    if (raw && raw.trim()) st.text = (st.text || '') + raw + '\n';
    return [];
  },
  finish(st, code) {
    return { type: 'result', ok: code === 0, text: st.text || '', denied: [] };
  },
  signInHint: 'Open a terminal, type "copilot" and sign in with GitHub once.',
};

// ---- Cursor CLI (unverified, Claude-like stream) ----------------------------------------------
const cursor = {
  id: 'cursor',
  args({ prompt, model, session, fullAccess }) {
    return ['-p', prompt, '--output-format', 'stream-json', ...(fullAccess ? ['--force'] : []), ...modelArgs('--model', model), ...sessionArgs('--resume', session)];
  },
  parse(o, st) {
    if (!o) return [];
    const ev = claude.parse(o, st);
    if (o.type === 'tool_call' && o.subtype === 'started' && o.tool_call) {
      const [name, val] = Object.entries(o.tool_call)[0] || [];
      ev.push({ type: 'step', text: describe(String(name || '').replace(/ToolCall$/, ''), val && val.args) });
    }
    return ev;
  },
  signInHint: 'Open a terminal, type "cursor-agent login" and sign in once.',
};

const ADAPTERS = { claude, antigravity, gemini, codex, opencode, copilot, cursor };

module.exports = { ADAPTERS };
