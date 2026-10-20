// `npm run publish`: pushes web/ to the repo's gh-pages branch (served by GitHub Pages), like Break My Eggs.
// Each publish stamps a new cache name into sw.js, so phones pick up the new version on their next launch.
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const REPO = 'https://github.com/AndreiBaloniu/pocket-decks.git';
const SITE = 'https://andreibaloniu.github.io/pocket-decks/';
const out = path.join(__dirname, '..', 'dist', 'web');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const f of ['index.html', 'app.js', 'sw.js', 'manifest.webmanifest', 'icon-180.png', 'icon-512.png', 'qr.svg', 'privacy.html'])
  fs.copyFileSync(path.join(__dirname, f), path.join(out, f));
const stamp = new Date().toISOString().slice(0, 16).replace(/\D/g, '');
const sw = path.join(out, 'sw.js');
fs.writeFileSync(sw, fs.readFileSync(sw, 'utf8').replace("'pocket-decks-dev'", `'pocket-decks-${stamp}'`));
fs.writeFileSync(path.join(out, '.nojekyll'), ''); // serve files as-is
// the installed iPhone app checks this to decide between the live site and its built-in offline copy
fs.writeFileSync(path.join(out, 'version.json'), JSON.stringify({ built: stamp }));

const git = (cmd) => execSync('git ' + cmd, { stdio: 'inherit', cwd: out });
git('init -q -b gh-pages'); git('add -A'); git('commit -q -m "Publish"');
git(`push -f ${REPO} gh-pages`);
console.log('Published! Live in a minute at', SITE);
