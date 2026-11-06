// Where everything lives. All personal data is under workspace/ (gitignored).
// Tests and power users can point HUNTBOARD_WORKSPACE at another folder.

const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function ws(...parts) {
  const base = path.resolve(process.env.HUNTBOARD_WORKSPACE || path.join(ROOT, 'workspace'));
  return path.join(base, ...parts);
}

module.exports = {
  ROOT,
  ws,
  applications: () => ws('applications'),
  profileDir: () => ws('profile'),
  profileFile: () => ws('profile', 'profile.json'),
  settingsFile: () => ws('settings.json'),
  documentsDir: () => ws('documents'),
  documentsIndex: () => ws('documents', 'documents.json'),
  dataDir: () => ws('data'),
  runsDir: () => ws('runs'),
  asksDir: () => ws('asks'),
  browserProfile: () => ws('browser-profile'),
  rel: (p) => path.relative(ROOT, p).split(path.sep).join('/'),
};
