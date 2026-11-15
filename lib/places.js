// Where a search looks for jobs: one or more places, each a city (searched with the radius) or a region such as
// "Sachsen", "Nordrhein-Westfalen" or "Emilia-Romagna" (searched as a whole, without a radius).
// The user lists them in Settings (profile.location.places, or a search's own location.places); the plan-search
// skill tells which ones are regions and adds the other names they go by (plan.places: [{ name, kind, aliases }]).

const { normalize } = require('./dedupe');
const { splitPlaces } = require('./profile');

const MAX_SEARCH_PLACES = 8; // each place multiplies the requests to every board

// The place names the user asked for, for this search.
function wanted(profile, target) {
  const own = target && target.location ? splitPlaces((target.location.places && target.location.places.length) ? target.location.places : target.location.city) : [];
  if (own.length) return own;
  const all = splitPlaces(profile.location.places);
  return all.length ? all : splitPlaces(profile.location.city);
}

// The radius for this search: the search's own, else the profile's.
function radius(profile, target) {
  return Number((target && target.location && target.location.radius_km) || profile.location.radius_km) || 25;
}

function cleanPlace(p) {
  if (!p) return null;
  const name = String(typeof p === 'string' ? p : p.name || '').trim();
  if (!name) return null;
  const kind = p.kind === 'region' ? 'region' : 'city';
  const list = (v, max) => [...new Set((Array.isArray(v) ? v : []).map((a) => String(a).trim()).filter(Boolean))].slice(0, max);
  const out = { name, kind, aliases: list(p.aliases, 8) };
  // A region's biggest cities: boards that cannot search a whole region search around these instead.
  if (kind === 'region') out.centers = list(p.centers, 5);
  return out;
}

// [{ name, kind, aliases }] for this search. A place the plan knows (by name or alias) takes the plan's kind and
// aliases; any other place is searched as a city.
function searchPlaces(profile, target, plan) {
  const known = ((plan && plan.places) || []).map(cleanPlace).filter(Boolean);
  const find = (n) => known.find((k) => [k.name, ...k.aliases].some((x) => normalize(x) === normalize(n)));
  return wanted(profile, target).slice(0, MAX_SEARCH_PLACES).map((n) => {
    const k = find(n);
    return k ? { ...k, name: n } : { name: n, kind: 'city', aliases: [] };
  });
}

// Places the user listed that the plan does not cover yet: the plan should be made again.
function missingFromPlan(profile, target, plan) {
  if (!plan) return [];
  const known = ((plan.places) || []).map(cleanPlace).filter(Boolean);
  const names = new Set(known.flatMap((k) => [k.name, ...k.aliases]).map(normalize));
  const towns = new Set((plan.towns || []).map(normalize));
  // Older plans have no places: their towns list counts (it starts with the user's city).
  return wanted(profile, target).filter((n) => !names.has(normalize(n)) && !(known.length === 0 && towns.has(normalize(n))));
}

// Does a job's location match a place name? Whole words only, so "Sachsen" is not "Niedersachsen".
function matches(location, name) {
  const l = ` ${normalize(location)} `;
  const n = normalize(name);
  return Boolean(n) && l.includes(` ${n} `);
}

module.exports = { searchPlaces, missingFromPlan, wanted, radius, matches, cleanPlace, MAX_SEARCH_PLACES };
