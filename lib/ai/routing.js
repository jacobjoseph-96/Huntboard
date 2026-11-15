// The right model for each task: a small, fast model for simple work, the strongest one where quality and truth
// matter most (the user's CV and letters), so the user's usage limit lasts much longer.
// Three tiers per AI tool, set in Settings → AI tool: light, standard, strong. An empty tier uses the tool's
// default model (or the single "Model" setting of older versions).

const TIERS = ['light', 'standard', 'strong'];

// Which tier each task uses unless the user moves it (settings.ai.task_tiers).
const DEFAULT_TIERS = {
  test: 'light',
  'follow-up': 'light',
  chat: 'standard',
  search: 'standard',
  'plan-search': 'standard',
  apply: 'standard',
  setup: 'standard',
  tailor: 'strong',
  'cover-letter': 'strong',
  email: 'strong',
  cv: 'strong',
  'cv-design': 'strong',
  'interview-prep': 'strong',
  'interview-debrief': 'strong',
};

const taskOf = (run) => (run.kind === 'skill' ? run.skill : run.kind);

function tierFor(settings, task) {
  const own = ((settings.ai || {}).task_tiers || {})[task];
  return TIERS.includes(own) ? own : DEFAULT_TIERS[task] || 'standard';
}

// The model name to pass to the tool for this task ('' = the tool's own default).
function modelFor(settings, toolId, task) {
  const ai = settings.ai || {};
  const models = (ai.models || {})[toolId] || {};
  const tier = tierFor(settings, task);
  const pick = String(models[tier] || '').trim();
  if (pick) return pick;
  // A tier left empty uses the standard one, then the old single "Model" setting, then the tool's default.
  return String(models.standard || '').trim() || String(ai.model || '').trim();
}

module.exports = { TIERS, DEFAULT_TIERS, tierFor, modelFor, taskOf };
