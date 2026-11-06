// Is this text really a job ad? Catches robot-check pages, login walls, empty page chrome and teasers,
// so a page that failed to load is counted as "unread", never mistaken for a short ad.

const MIN_LEN = 300;

const CHALLENGE = /additional verification required|verify you are human|just a moment|checking your browser|cf-browser-verification|cf_chl|attention required|enable javascript and cookies|unusual traffic|are you a robot|captcha|bot protection|request blocked|403 forbidden|please turn javascript on/i;
const LOGIN_WALL = /sign in to (see|view|continue)|log in to (see|view|continue)|jetzt einloggen oder konto erstellen|accedi per (vedere|continuare)|connectez-vous pour/i;
const CHROME = /LinkedIn respects your privacy|Join or sign in to find your next job|Select Accept to consent or Reject to decline|Skip to main content/i;
// Words a job ad uses somewhere, in the languages Huntboard is used in most.
const ADLIKE = /responsibilit|requirement|qualification|what you|your role|about the (job|role)|we offer|benefits|apply|experience|skills|full.?time|part.?time|equal opportunit|aufgaben|profil|wir bieten|bewerb|erfahrung|kenntnisse|mansioni|requisiti|offriamo|candidat|esperienza|competenze|orario|contratto|missions?|compétences|nous offrons|postuler|requisitos|ofrecemos|experiencia|funciones|wymagania|oferujemy|obowiązki|vereisten|wij bieden|ervaring/i;

function check(text) {
  const t = String(text || '');
  const head = t.slice(0, 3000);
  if (CHALLENGE.test(head) && t.length < 6000) return { ok: false, reason: 'robot_check' };
  if (LOGIN_WALL.test(head) && t.length < 4000) return { ok: false, reason: 'login_wall' };
  if (CHROME.test(head) && t.length < 3000) return { ok: false, reason: 'page_not_rendered' };
  if (t.trim().length < MIN_LEN) return { ok: false, reason: 'too_short' };
  if (!ADLIKE.test(t)) return { ok: false, reason: 'not_a_job_ad' };
  return { ok: true, reason: null };
}

module.exports = { check, MIN_LEN };
