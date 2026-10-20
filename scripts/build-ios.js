// `npm run build-ios`: builds the iPhone app (Pocket-Decks.ipa) on a free GitHub cloud Mac, like Break My Eggs.
// Pushes a tiny "ios-build" branch (launcher page, icon, Capacitor config, build steps); the cloud Mac takes the
// already-published site from gh-pages as the offline copy. When it finishes (~10 min) the .ipa is attached to
// the latest GitHub release. It is unsigned: install it with Sideloadly, which signs it with your own Apple ID.
// Only needs re-running when the app shell changes (icon, Google client ID), not for app updates: the app opens
// the live site whenever it's online.
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const REPO = 'https://github.com/AndreiBaloniu/pocket-decks.git';
const SITE = 'https://andreibaloniu.github.io/pocket-decks/';
const APP_ID = 'io.github.andreibaloniu.pocketdecks';
const CAP = '8.5.3';

// the app's URL scheme must be the reversed iOS client ID, so Google can hand the sign-in back
const clientId = (fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8').match(/GOOGLE_IOS_CLIENT_ID = '([^']*)'/) || [])[1];
if (!clientId) throw new Error('Set GOOGLE_IOS_CLIENT_ID in web/app.js first (see README), then run npm run publish and this again.');
const scheme = clientId.split('.').reverse().join('.');

const out = path.join(__dirname, '..', 'dist', 'ios-ci');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'www'), { recursive: true });
fs.mkdirSync(path.join(out, '.github', 'workflows'), { recursive: true });

// start page: the newest online version if it answers, else the copy inside the app (www/game)
fs.writeFileSync(path.join(out, 'www', 'index.html'), `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>html,body{margin:0;height:100%;display:flex;align-items:center;justify-content:center;background:#0f1218;
color:#8a93a6;font:13px ui-monospace,Menlo,monospace}</style></head><body>Loading Pocket Decks…<script>
const SITE = ${JSON.stringify(SITE)}, ctl = new AbortController(); setTimeout(() => ctl.abort(), 3500);
fetch(SITE + 'version.json', { cache: 'no-store', signal: ctl.signal })
  .then(r => { if (!r.ok) throw 0; location.replace(SITE + '?app=ios'); })
  .catch(() => location.replace('game/index.html?app=ios'));
</script></body></html>`);
fs.copyFileSync(path.join(__dirname, 'ios', 'icon-1024.png'), path.join(out, 'icon.png'));
fs.copyFileSync(path.join(__dirname, 'ios', 'splash-2732.png'), path.join(out, 'splash.png'));
fs.writeFileSync(path.join(out, 'package.json'), JSON.stringify({ name: 'pocket-decks-ios', private: true, dependencies: {
  '@capacitor/core': CAP, '@capacitor/cli': CAP, '@capacitor/ios': CAP, '@capacitor/app': '8.1.2', '@capacitor/browser': '8.0.5' } }, null, 2));
fs.writeFileSync(path.join(out, 'capacitor.config.json'), JSON.stringify({ appId: APP_ID, appName: 'Pocket Decks', webDir: 'www',
  server: { allowNavigation: [new URL(SITE).host] }, ios: { backgroundColor: '#0f1218', contentInset: 'never', scrollEnabled: true } }, null, 2));

fs.writeFileSync(path.join(out, '.github', 'workflows', 'ios.yml'), `name: iPhone app
on: [push, workflow_dispatch]
permissions: { contents: write }
jobs:
  ios:
    runs-on: macos-26
    steps:
      - uses: actions/checkout@v4
      - uses: actions/checkout@v4
        with: { ref: gh-pages, path: www/game }
      - run: rm -rf www/game/.git
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm install && npx cap add ios
      - name: Google sign-in URL scheme, music keeps playing with the screen locked, screen stays on, icon + splash
        run: |
          P=ios/App/App/Info.plist; PB=/usr/libexec/PlistBuddy
          $PB -c "Delete :CFBundleURLTypes" $P || true
          $PB -c "Add :CFBundleURLTypes array" -c "Add :CFBundleURLTypes:0 dict" \\
              -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes array" -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string ${scheme}" $P
          $PB -c "Delete :UIBackgroundModes" $P || true
          $PB -c "Add :UIBackgroundModes array" -c "Add :UIBackgroundModes:0 string audio" $P
          sed -i '' '/didFinishLaunchingWithOptions/a\\
          UIApplication.shared.isIdleTimerDisabled = true
          ' ios/App/App/AppDelegate.swift
          A=ios/App/App/Assets.xcassets
          for F in $A/AppIcon.appiconset/*.png; do sips -z 1024 1024 icon.png --out "$F"; done
          for F in $A/Splash.imageset/*.png; do cp splash.png "$F"; done
      - name: Build (unsigned)
        run: |
          set -o pipefail
          if [ -d ios/App/App.xcworkspace ]; then T="-workspace ios/App/App.xcworkspace"; else T="-project ios/App/App.xcodeproj"; fi
          xcodebuild $T -scheme App -configuration Release -destination 'generic/platform=iOS' -derivedDataPath build \\
            CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" build | tail -40
          mkdir Payload && cp -R build/Build/Products/Release-iphoneos/App.app Payload/ && zip -qry Pocket-Decks.ipa Payload
      - uses: actions/upload-artifact@v4
        with: { name: Pocket-Decks-ipa, path: Pocket-Decks.ipa }
      - name: Attach to the latest release (made on the first build)
        env:
          GH_TOKEN: \${{ github.token }}
        run: |
          R=\${{ github.repository }}
          TAG=$(gh release view --repo $R --json tagName -q .tagName 2>/dev/null || true)
          if [ -z "$TAG" ]; then TAG=v1; gh release create $TAG --repo $R --target gh-pages --title "Pocket Decks" --notes "iPhone app: install Pocket-Decks.ipa with Sideloadly."; fi
          gh release upload "$TAG" Pocket-Decks.ipa --clobber --repo $R
`);

const git = (cmd) => execSync('git ' + cmd, { stdio: 'inherit', cwd: out });
git('init -q -b ios-build'); git('add -A'); git('commit -q -m "iPhone app build"');
git(`push -f ${REPO} ios-build`);
console.log('iPhone build started: https://github.com/AndreiBaloniu/pocket-decks/actions');
console.log('The .ipa lands on https://github.com/AndreiBaloniu/pocket-decks/releases/latest in ~10 min.');
