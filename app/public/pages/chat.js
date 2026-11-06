import { app, api, html, raw, md, toast, when, $ } from '../app.js';

let mainEl = null;

const EXAMPLES = [
  'Which of my jobs on the board fits me best, and why?',
  'What should I improve in my CV for hotel jobs?',
  'Write a short message to ask a company about the status of my application.',
];

export async function render(main) {
  mainEl = main;
  const runs = (await api('GET', '/api/runs')).filter((r) => r.kind === 'chat').reverse();
  for (const r of runs) app.runs.set(r.id, { ...(app.runs.get(r.id) || {}), ...r });
  const tool = app.tools && app.tools.tools.find((t) => t.id === app.state.settings.ai.tool);
  main.innerHTML = html`<div class="page" style="display:flex;flex-direction:column;min-height:100%">
    <div class="page-head"><div class="grow"><h1>Ask the AI</h1><p class="muted">Ask anything about your job search, your CV or a job on your board. ${tool ? `You are talking to ${tool.name}.` : ''}</p></div>
      <button class="btn ghost" id="reset">New conversation</button></div>
    <div class="chat" id="chat" style="flex:1">
      ${runs.length ? runs.map(bubbles) : html`<div class="empty">Try: ${EXAMPLES.map((e) => html`<button class="chip" data-ex="${e}" style="margin:4px">${e}</button>`)}</div>`}
    </div>
    <div class="chat-input"><textarea id="msg" placeholder="Type your message… (Enter to send, Shift+Enter for a new line)"></textarea>
      <button class="btn primary" id="send">Send</button></div></div>`.s;
  const chatEl = $('#chat', main);
  chatEl.lastElementChild && chatEl.lastElementChild.scrollIntoView();
  const msg = $('#msg', main);
  msg.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  $('#send', main).addEventListener('click', send);
  $('#reset', main).addEventListener('click', async () => { await api('POST', '/api/chat/reset'); toast('The next message starts a new conversation.'); });
  main.querySelectorAll('[data-ex]').forEach((b) => b.addEventListener('click', () => { msg.value = b.dataset.ex; msg.focus(); }));
}

function bubbles(r) {
  const live = r.status === 'running' || r.status === 'queued';
  return html`<div class="bubble user" title="${when(r.created_at)}">${r.message || r.title}</div>
    <div class="bubble ai" data-run="${r.id}">${live ? html`<div class="row"><span class="spinner"></span><span class="muted">${(r.steps && r.steps.length ? r.steps[r.steps.length - 1].text : 'Thinking…')}</span></div>`
      : r.error ? html`<span style="color:var(--danger)">${r.error}</span>` : html`<div class="md">${raw(md(r.result_text || '(no answer)'))}</div>`}</div>`;
}

async function send() {
  const msg = $('#msg', mainEl);
  const text = msg.value.trim();
  if (!text) return;
  if (!app.state.settings.ai.tool) return toast('Choose your AI tool in Settings first.', true);
  msg.value = '';
  try {
    const run = await api('POST', '/api/chat', { message: text, context: { page: 'chat' } });
    run.message = text;
    app.runs.set(run.id, run);
    await render(mainEl);
  } catch (err) {
    toast(err.message, true);
    msg.value = text;
  }
}

export function onEvent(name, data) {
  if (name !== 'run' || !mainEl || data.kind !== 'chat') return;
  const el = mainEl.querySelector(`[data-run="${data.id}"]`);
  if (!el) return render(mainEl);
  const r = { ...(app.runs.get(data.id) || {}), ...data };
  const tmp = document.createElement('div');
  tmp.innerHTML = bubbles(r).s;
  el.replaceWith(tmp.lastElementChild);
}
