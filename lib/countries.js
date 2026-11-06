// Country names (in English and the local language) → ISO 3166 alpha-2, plus per-board details.

const COUNTRIES = {
  AT: ['austria', 'österreich', 'oesterreich'],
  AU: ['australia'],
  BE: ['belgium', 'belgië', 'belgie', 'belgique', 'belgien'],
  BR: ['brazil', 'brasil'],
  CA: ['canada'],
  CH: ['switzerland', 'schweiz', 'suisse', 'svizzera'],
  CZ: ['czechia', 'czech republic', 'česko', 'cesko'],
  DE: ['germany', 'deutschland'],
  DK: ['denmark', 'danmark'],
  ES: ['spain', 'españa', 'espana'],
  FI: ['finland', 'suomi'],
  FR: ['france'],
  GB: ['united kingdom', 'uk', 'great britain', 'england', 'scotland', 'wales', 'britain'],
  GR: ['greece', 'ελλάδα', 'ellada'],
  HU: ['hungary', 'magyarország', 'magyarorszag'],
  IE: ['ireland', 'éire', 'eire'],
  IN: ['india'],
  IT: ['italy', 'italia'],
  LU: ['luxembourg', 'luxemburg'],
  MT: ['malta'],
  MX: ['mexico', 'méxico'],
  NL: ['netherlands', 'nederland', 'holland', 'the netherlands'],
  NO: ['norway', 'norge'],
  NZ: ['new zealand'],
  PL: ['poland', 'polska'],
  PT: ['portugal'],
  RO: ['romania', 'românia'],
  SE: ['sweden', 'sverige'],
  SG: ['singapore'],
  US: ['united states', 'usa', 'us', 'united states of america', 'america'],
  ZA: ['south africa'],
  AE: ['united arab emirates', 'uae', 'emirates'],
};

const EU_EEA = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO', 'CH'];

// Main language(s) of the country: used for search words and document language.
const LANGUAGES = {
  AT: 'German', CH: 'German', DE: 'German', LU: 'French', BE: 'Dutch', NL: 'Dutch', FR: 'French', IT: 'Italian',
  ES: 'Spanish', MX: 'Spanish', PT: 'Portuguese', BR: 'Portuguese', PL: 'Polish', CZ: 'Czech', DK: 'Danish',
  SE: 'Swedish', NO: 'Norwegian', FI: 'Finnish', GR: 'Greek', HU: 'Hungarian', RO: 'Romanian', AE: 'English',
  GB: 'English', IE: 'English', US: 'English', CA: 'English', AU: 'English', NZ: 'English', IN: 'English',
  SG: 'English', ZA: 'English', MT: 'English',
};

// Indeed's site for each country.
const INDEED = { US: 'www.indeed.com', GB: 'uk.indeed.com' };

function toIso(country) {
  const s = String(country || '').trim();
  if (/^[A-Za-z]{2}$/.test(s)) {
    const up = s.toUpperCase();
    return up === 'UK' ? 'GB' : up;
  }
  const low = s.toLowerCase();
  for (const [iso, names] of Object.entries(COUNTRIES)) if (names.includes(low)) return iso;
  return null;
}

function indeedHost(iso) {
  return INDEED[iso] || `${String(iso || 'www').toLowerCase()}.indeed.com`;
}

module.exports = { COUNTRIES, EU_EEA, LANGUAGES, toIso, indeedHost };
