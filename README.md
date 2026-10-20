# Pocket Decks

Two-deck DJ mixer for iPhone. Each deck plays a YouTube track (YouTube's official player) or a song file from the Files app.

## How it works

Same setup as Break My Eggs: a plain web app published to GitHub Pages, added to the iPhone Home Screen. No Expo, no Apple Developer account.

- `npm run publish` pushes `web/` to the `gh-pages` branch of github.com/AndreiBaloniu/pocket-decks. It goes live at https://andreibaloniu.github.io/pocket-decks/
- On the iPhone: open that address in Safari › Share › **Add to Home Screen**. It then opens full screen, and works **offline** for song files, effects, auto remix and recording (YouTube needs internet).
- YouTube setup happens inside the app: YouTube › **Setup** tab. The API key and OAuth client ID are saved only in that phone's browser, never in the repo.
- `npm run check-beats` checks the tempo and beat-grid detection the auto remix cuts on.
- `npm run preview` serves `web/` locally at http://localhost:5173

YouTube decks: YouTube's player only lets apps change volume, position and speed in 25% steps, so pitch, nudge, SYNC, EQ, effects, remix and recording work on song-file decks only.
