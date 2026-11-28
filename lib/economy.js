// "Save AI usage": limits that let a search finish on a free or student plan (Antigravity, Gemini...).
// Huntboard's own code does the collecting, filtering, reading and first fit check; these limits cap what is left
// for the AI: how many jobs it scores, how many boards it opens in the browser, how many web searches it makes.
// settings.ai.economy: 'auto' (on for the tools with small free plans), 'on' or 'off'.

const SMALL_PLANS = ['antigravity', 'gemini'];

const LIMITS = {
  on: { candidates: 12, browser_boards: 2, browser_pages: 1, browser_queries: 3, discover_searches: 4, discover_every_days: 7 },
  off: { candidates: 30, browser_boards: 6, browser_pages: 2, browser_queries: 8, discover_searches: 14, discover_every_days: 1 },
};

function isOn(settings) {
  const ai = (settings && settings.ai) || {};
  if (ai.economy === 'on' || ai.economy === true) return true;
  if (ai.economy === 'off' || ai.economy === false) return false;
  return SMALL_PLANS.includes(ai.tool);
}

function limits(settings = require('./profile').loadSettings()) {
  const on = isOn(settings);
  return { on, ...LIMITS[on ? 'on' : 'off'] };
}

module.exports = { isOn, limits, LIMITS, SMALL_PLANS };
