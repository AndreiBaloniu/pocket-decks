'use strict';
// Google sign-in client IDs. Not secret: they only tell Google which app is asking.
// iOS: the installed iPhone app (bundle ID io.github.andreibaloniu.pocketdecks). Web: Safari / Home Screen.
const GOOGLE_IOS_CLIENT_ID = '140526101246-8dhlsir389qm95moggkagbobc8tjcqe5.apps.googleusercontent.com';
const GOOGLE_WEB_CLIENT_ID = '140526101246-hh6rg6himebv2o5i7hnqqrva290gbkup.apps.googleusercontent.com';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const store = {
  get: (k) => { try { return localStorage.getItem('pd.' + k) || ''; } catch { return ''; } },
  set: (k, v) => { try { localStorage.setItem('pd.' + k, v); } catch {} },
};

// ---------- audio engine (song-file decks) ----------
const ctx = new (window.AudioContext || window.webkitAudioContext)();
try { navigator.audioSession.type = 'playback'; } catch {} // iOS: play with the silent switch on
const lim = ctx.createDynamicsCompressor();
lim.threshold.value = -6; lim.ratio.value = 12; lim.connect(ctx.destination);
const recDest = ctx.createMediaStreamDestination ? ctx.createMediaStreamDestination() : null;
if (recDest) lim.connect(recDest);
document.addEventListener('pointerdown', () => { if (ctx.state !== 'running') ctx.resume(); });

function bq(type, f) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; return b; }

const DECK_HTML = `
  <div class="head"><span class="tag"></span><div class="title">Empty deck</div>
    <button class="small yt-btn">YouTube</button>
    <label class="small">File<input type="file" accept="audio/*" hidden></label></div>
  <p class="note empty">Load a track from YouTube or from your Files.</p>
  <div class="ytbox ytonly"><div class="ytp"></div></div>
  <canvas class="loaded" aria-label="Track position. Tap or drag to jump."></canvas>
  <p class="status" hidden></p>
  <div class="readout loaded"><span><b class="time">0:00.0</b> <span class="dim remain"></span></span><span><b class="bpm">—</b> <span class="dim">BPM</span> <span class="dim pct">+0.0%</span></span></div>
  <div class="grid g5 transport loaded"><button class="cue">CUE</button><button class="play" aria-label="Play">▶</button><button class="sync">SYNC</button><button class="nudge" data-n="-1" aria-label="Hold to slow down">‹‹</button><button class="nudge" data-n="1" aria-label="Hold to speed up">››</button></div>
  <div class="lbl loaded">Hot cues · tap to set, tap to jump, hold to clear</div>
  <div class="grid g4 hot loaded"><button>1</button><button>2</button><button>3</button><button>4</button></div>
  <div class="lbl loaded">Loop (beats)</div>
  <div class="grid g5 loops loaded"><button data-b="1">1</button><button data-b="2">2</button><button data-b="4">4</button><button data-b="8">8</button><button class="tap" aria-label="Tap along to set BPM">TAP</button></div>
  <div class="ctl fileonly"><span data-r="0">PITCH</span><input class="pitch" type="range" min="-16" max="16" step="0.1" value="0" aria-label="Pitch"><output></output></div>
  <div class="ctl loaded"><span data-r="1">VOL</span><input class="vol" type="range" min="0" max="1" step="0.01" value="1" aria-label="Volume"><output></output></div>
  <div class="ctl fileonly"><span data-r="0">HIGH</span><input class="eq" data-k="high" type="range" min="-26" max="6" step="0.5" value="0" aria-label="High EQ"><output></output></div>
  <div class="ctl fileonly"><span data-r="0">MID</span><input class="eq" data-k="mid" type="range" min="-26" max="6" step="0.5" value="0" aria-label="Mid EQ"><output></output></div>
  <div class="ctl fileonly"><span data-r="0">LOW</span><input class="eq" data-k="low" type="range" min="-26" max="6" step="0.5" value="0" aria-label="Low EQ"><output></output></div>
  <div class="ctl fileonly"><span data-r="0">FILTER</span><input class="filt" type="range" min="-1" max="1" step="0.01" value="0" aria-label="Filter"><output></output></div>
  <div class="grid g3 fileonly"><button class="echo">ECHO</button><button class="remix">AUTO REMIX</button><button class="orig" hidden>ORIGINAL</button></div>
  <p class="note fileonly remixnote" hidden>Playing a remix: fills every 4 bars, swapped bars, and a build every 16 bars. Tap REMIX AGAIN for a new version.</p>
  <p class="note ytonly">YouTube's player only lets apps change volume, position and speed in 25% steps, so pitch, nudge, SYNC, EQ, effects,
    remix and recording work on song files only. Tap TAP along with the beat so a song-file deck can SYNC to this one.
    The first time, tap play on the video itself; after that the deck buttons work.</p>`;

const decks = $$('.deck').map(makeDeck);

function makeDeck(el) {
  el.innerHTML = DECK_HTML;
  const d = { i: +el.dataset.d, el, mode: null, buf: null, orig: null, src: null, pos: 0, t0: 0, playing: false,
    pitch: 0, nudge: 0, bpm: 0, cue: 0, hot: [null, null, null, null], loop: null, peaks: null, vol: 1, xf: 1,
    taps: [], player: null, ytReady: false, ytT: 0, ytDur: 0, echo: false };
  $('.tag', el).textContent = 'AB'[d.i];
  d.low = bq('lowshelf', 250); d.mid = bq('peaking', 1000); d.high = bq('highshelf', 4000); d.mid.Q.value = 0.7;
  d.filt = bq('lowpass', 20000); d.fader = ctx.createGain();
  d.delay = ctx.createDelay(2); d.fb = ctx.createGain(); d.fb.gain.value = 0.45; d.wet = ctx.createGain(); d.wet.gain.value = 0;
  d.low.connect(d.mid).connect(d.high).connect(d.filt).connect(d.fader).connect(lim);
  d.fader.connect(d.delay).connect(d.fb).connect(d.delay);
  d.delay.connect(d.wet).connect(lim);
  wire(d);
  return d;
}

// YouTube decks always play at 1x: the player only accepts speeds in 25% steps and ignores the rest
const rate = (d) => (d.mode === 'yt' ? 1 : (1 + d.pitch / 100) * (1 + d.nudge));
const dur = (d) => (d.mode === 'file' ? d.buf?.duration || 0 : d.ytDur);
function cur(d) {
  if (d.mode === 'yt') return d.ytT;
  if (!d.buf) return 0;
  if (!d.playing) return d.pos;
  let t = d.pos + (ctx.currentTime - d.t0) * rate(d);
  if (d.loop && t >= d.loop.end) t = d.loop.start + (t - d.loop.start) % (d.loop.end - d.loop.start);
  return Math.min(t, d.buf.duration);
}
function commit(d) { d.pos = cur(d); d.t0 = ctx.currentTime; }

function play(d) {
  if (d.mode === 'yt') { if (d.ytReady) d.player.playVideo(); return; }
  if (!d.buf || d.playing) return;
  ctx.resume();
  if (d.pos >= d.buf.duration) d.pos = 0;
  const s = ctx.createBufferSource();
  s.buffer = d.buf; s.playbackRate.value = rate(d);
  if (d.loop) { s.loop = true; s.loopStart = d.loop.start; s.loopEnd = d.loop.end; }
  s.connect(d.low);
  s.onended = () => { if (d.src === s) { d.src = null; d.playing = false; d.pos = 0; ui(d); } };
  s.start(0, d.pos);
  d.src = s; d.t0 = ctx.currentTime; d.playing = true; ui(d);
}
function pause(d) {
  if (d.mode === 'yt') { if (d.ytReady) d.player.pauseVideo(); return; }
  if (!d.playing) return;
  commit(d); d.playing = false;
  const s = d.src; d.src = null; s.stop(); ui(d);
}
function seek(d, t) {
  if (!dur(d)) return;
  t = Math.max(0, Math.min(t, dur(d) - 0.01));
  if (d.loop && (t < d.loop.start || t >= d.loop.end)) setLoopOff(d);
  if (d.mode === 'yt') { if (d.ytReady) d.player.seekTo(t, true); d.ytT = t; return ui(d); }
  const was = d.playing; pause(d);
  d.pos = t;
  if (was) play(d); else ui(d);
}
function applyRate(d) {
  if (d.mode === 'file') { commit(d); if (d.src) d.src.playbackRate.value = rate(d); }
  ui(d);
}
function applyGain(d) {
  const g = d.vol * d.xf;
  if (d.mode === 'yt') { if (d.ytReady) d.player.setVolume(Math.round(g * 100)); }
  else d.fader.gain.setTargetAtTime(g, ctx.currentTime, 0.01);
}
function setLoopOff(d) {
  if (d.mode === 'file') { commit(d); if (d.src) d.src.loop = false; }
  d.loop = null;
}
function setLoop(d, beats) {
  if (!dur(d)) return;
  if (d.loop && d.loop.beats === beats) { setLoopOff(d); return ui(d); }
  if (d.mode === 'file') commit(d);
  const start = d.loop ? d.loop.start : cur(d);
  d.loop = { beats, start, end: Math.min(start + beats * 60 / (d.bpm || 120), dur(d)) };
  if (d.mode === 'file') {
    if (d.pos >= d.loop.end) d.pos = d.loop.start;
    if (d.src) { d.src.loopStart = d.loop.start; d.src.loopEnd = d.loop.end; d.src.loop = true; }
  }
  ui(d);
}
function setFilter(d, v) {
  // one knob: left = low-pass sweep, right = high-pass sweep
  if (v < 0) { d.filt.type = 'lowpass'; d.filt.frequency.value = 20000 * Math.pow(150 / 20000, -v); }
  else { d.filt.type = 'highpass'; d.filt.frequency.value = 20 * Math.pow(4000 / 20, v); }
  d.filt.Q.value = Math.abs(v) > 0.05 ? 4 : 0.7;
}
function status(d, msg) { const p = $('.status', d.el); p.textContent = msg; p.hidden = !msg; }

// Switches a deck to a new source: stops the old one and clears cues, loops and remixes.
function setMode(d, mode, title) {
  pause(d);
  if (d.player) { d.player.destroy(); d.player = null; }
  Object.assign(d, { mode, buf: null, orig: null, pos: 0, playing: false, cue: 0, hot: [null, null, null, null],
    loop: null, peaks: null, ytReady: false, ytT: 0, ytDur: 0, bpm: 0 });
  d.el.classList.toggle('is-file', mode === 'file');
  d.el.classList.toggle('is-yt', mode === 'yt');
  $('.title', d.el).textContent = title;
  status(d, '');
  updateRecNote();
  ui(d);
}
function setBuffer(d, buf, bpm) {
  pause(d);
  Object.assign(d, { buf, pos: 0, loop: null, peaks: peaks(buf, 600), bpm });
  applyGain(d); ui(d);
}
async function loadFile(d, f) {
  setMode(d, 'file', f.name.replace(/\.[^.]+$/, ''));
  status(d, 'Decoding…');
  try {
    const buf = await ctx.decodeAudioData(await f.arrayBuffer());
    setBuffer(d, buf, detectBPM(buf));
    status(d, '');
  } catch { status(d, "Can't read that file. Try MP3, M4A or WAV."); }
}

// ---------- YouTube decks (official IFrame player) ----------
let ytApi;
function ytLoad() {
  return ytApi ||= new Promise((res, rej) => {
    window.onYouTubeIframeAPIReady = res;
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { ytApi = null; rej(); };
    document.head.append(s);
  });
}
async function loadYouTube(d, row) {
  setMode(d, 'yt', row.title);
  status(d, 'Loading YouTube player…');
  try { await ytLoad(); } catch { return status(d, "YouTube can't load right now. Check your internet connection."); }
  const host = document.createElement('div');
  $('.ytp', d.el).replaceChildren(host);
  d.player = new YT.Player(host, {
    videoId: row.id, width: '100%', height: '200',
    playerVars: { playsinline: 1, rel: 0 },
    events: {
      onReady: () => { d.ytReady = true; d.ytDur = d.player.getDuration(); applyGain(d); status(d, ''); },
      onStateChange: (e) => {
        d.playing = e.data === YT.PlayerState.PLAYING;
        if (d.playing && !d.ytDur) d.ytDur = d.player.getDuration();
        ui(d);
      },
      onError: (e) => status(d, e.data === 101 || e.data === 150
        ? 'This track can only play on YouTube itself. Pick another one.' : `YouTube error ${e.data}. Pick another track.`),
    },
  });
}

// ---------- controls ----------
function wire(d) {
  const { el } = d;
  $('.play', el).onclick = () => (d.playing ? pause(d) : play(d));
  $('.cue', el).onclick = () => {
    if (!dur(d)) return;
    if (d.playing) { seek(d, d.cue); pause(d); } else { d.cue = cur(d); ui(d); }
  };
  $('.sync', el).onclick = () => {
    const o = decks[1 - d.i];
    if (!d.bpm || !o.bpm) return status(d, 'Both decks need a BPM to sync. Use TAP on the deck that shows —.');
    d.pitch = Math.max(-16, Math.min(16, (o.bpm * rate(o) / d.bpm - 1) * 100));
    $('.pitch', el).value = d.pitch; applyRate(d);
  };
  $$('.nudge', el).forEach((b) => {
    b.onpointerdown = (e) => { e.preventDefault(); b.setPointerCapture(e.pointerId); d.nudge = 0.04 * b.dataset.n; applyRate(d); };
    b.onpointerup = b.onpointercancel = () => { if (d.nudge) { d.nudge = 0; applyRate(d); } };
  });
  $$('.hot button', el).forEach((b, i) => {
    let timer, held = false;
    b.onpointerdown = () => { held = false; timer = setTimeout(() => { held = true; d.hot[i] = null; ui(d); }, 600); };
    b.onpointerup = b.onpointercancel = () => clearTimeout(timer);
    b.onclick = () => {
      if (held || !dur(d)) return;
      if (d.hot[i] == null) { d.hot[i] = cur(d); ui(d); } else { seek(d, d.hot[i]); if (!d.playing) play(d); }
    };
  });
  $$('.loops [data-b]', el).forEach((b) => (b.onclick = () => setLoop(d, +b.dataset.b)));
  $('.tap', el).onclick = () => {
    const now = performance.now();
    d.taps = d.taps.filter((t) => now - t < 2500).concat(now);
    const n = d.taps.length - 1;
    if (n > 0) { d.bpm = Math.round(60000 * n / (now - d.taps[0]) / rate(d) * 10) / 10; ui(d); }
  };
  $('.pitch', el).oninput = (e) => { d.pitch = +e.target.value; applyRate(d); };
  $('.vol', el).oninput = (e) => { d.vol = +e.target.value; applyGain(d); ui(d); };
  $$('.eq', el).forEach((r) => (r.oninput = () => { d[r.dataset.k].gain.value = +r.value; ui(d); }));
  $('.filt', el).oninput = (e) => { setFilter(d, +e.target.value); ui(d); };
  $$('.ctl span', el).forEach((s) => (s.onclick = () => {
    const r = s.nextElementSibling; r.value = s.dataset.r; r.dispatchEvent(new Event('input'));
  }));
  $('.echo', el).onclick = () => {
    d.echo = !d.echo;
    d.delay.delayTime.value = Math.min(2, 0.75 * 60 / ((d.bpm || 120) * rate(d)));
    d.wet.gain.setTargetAtTime(d.echo ? 0.5 : 0, ctx.currentTime, 0.02);
    ui(d);
  };
  $('.remix', el).onclick = async () => {
    if (!d.buf) return;
    if (!d.bpm) return status(d, 'Set the BPM with TAP first, so the remix lands on the beat.');
    status(d, 'Remixing…');
    try {
      const buf = await remix(d.orig || d.buf, d.bpm, Date.now());
      d.orig ||= d.buf;
      setBuffer(d, buf, d.bpm);
      status(d, '');
    } catch (e) { status(d, `Remix failed: ${e.message}`); }
  };
  $('.orig', el).onclick = () => { if (d.orig) { const o = d.orig; d.orig = null; setBuffer(d, o, d.bpm); } };
  $('.yt-btn', el).onclick = () => openLib(d.i);
  $('input[type=file]', el).onchange = (e) => {
    const f = e.target.files[0];
    if (f) loadFile(d, f);
    e.target.value = '';
  };
  const cv = $('canvas', el);
  const scrub = (e) => { const r = cv.getBoundingClientRect(); seek(d, (e.clientX - r.left) / r.width * dur(d)); };
  cv.onpointerdown = (e) => { cv.setPointerCapture(e.pointerId); scrub(e); };
  cv.onpointermove = (e) => { if (cv.hasPointerCapture(e.pointerId)) scrub(e); };
  $$('input[type=range]', el).forEach((r) => r.dispatchEvent(new Event('input')));
}

const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
function ui(d) {
  const { el } = d;
  $('.play', el).textContent = d.playing ? '❚❚' : '▶';
  $('.play', el).classList.toggle('on', d.playing);
  $('.play', el).setAttribute('aria-label', d.playing ? 'Pause' : 'Play');
  $('.bpm', el).textContent = d.bpm ? (d.bpm * rate(d)).toFixed(1) : '—';
  $('.pct', el).textContent = (d.pitch >= 0 ? '+' : '') + d.pitch.toFixed(1) + '%';
  $$('.hot button', el).forEach((b, i) => b.classList.toggle('set', d.hot[i] != null));
  $$('.loops [data-b]', el).forEach((b) => b.classList.toggle('on', d.loop?.beats === +b.dataset.b));
  $('.echo', el).classList.toggle('on', d.echo);
  $('.remix', el).textContent = d.orig ? 'REMIX AGAIN' : 'AUTO REMIX';
  $('.remix', el).classList.toggle('set', !!d.orig);
  $('.orig', el).hidden = !d.orig;
  $('.remixnote', el).hidden = !d.orig;
  $$('.ctl', el).forEach((c) => {
    const r = $('input', c), v = +r.value;
    $('output', c).textContent =
      r.classList.contains('eq') ? (v <= -26 ? 'KILL' : (v > 0 ? '+' : '') + v + 'dB') :
      r.classList.contains('filt') ? (Math.abs(v) < 0.05 ? 'OFF' : (v < 0 ? 'LP ' : 'HP ') + Math.round(Math.abs(v) * 100)) :
      r.classList.contains('pitch') ? (v > 0 ? '+' : '') + v.toFixed(1) : Math.round(v * 100);
  });
}

// ---------- waveform + clock (every frame) ----------
function frame() {
  for (const d of decks) {
    if (d.mode === 'yt' && d.ytReady) {
      d.ytT = d.player.getCurrentTime() || 0;
      if (d.loop && d.ytT >= d.loop.end) { d.player.seekTo(d.loop.start, true); d.ytT = d.loop.start; }
    }
    const total = dur(d);
    if (!d.mode) continue;
    const cv = $('canvas', d.el), dpr = devicePixelRatio || 1;
    const W = Math.round(cv.clientWidth * dpr), H = Math.round(cv.clientHeight * dpr);
    if (!W) continue;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const g = cv.getContext('2d'), c = getComputedStyle(d.el).getPropertyValue('--c');
    g.clearRect(0, 0, W, H);
    const t = cur(d), x = total ? t / total * W : 0;
    if (d.loop && total) { g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(d.loop.start / total * W, 0, (d.loop.end - d.loop.start) / total * W, H); }
    if (d.peaks) {
      const n = d.peaks.length, bw = W / n;
      for (let i = 0; i < n; i++) {
        const h = Math.max(1, d.peaks[i] * H * 0.95);
        g.fillStyle = i * bw < x ? c : '#4a5263';
        g.fillRect(i * bw, (H - h) / 2, Math.max(1, bw - dpr * 0.5), h);
      }
    } else {
      g.fillStyle = '#2a303c'; g.fillRect(0, H / 2 - 2 * dpr, W, 4 * dpr);
      g.fillStyle = c; g.fillRect(0, H / 2 - 2 * dpr, x, 4 * dpr);
    }
    if (total) {
      g.fillStyle = '#e7eaf0';
      g.font = `${10 * dpr}px ui-monospace, Menlo, monospace`;
      d.hot.forEach((h, i) => { if (h != null) { const hx = h / total * W; g.fillRect(hx, 0, dpr, H); g.fillText(i + 1, hx + 3 * dpr, 11 * dpr); } });
      g.fillRect(x - dpr, 0, 2 * dpr, H);
    }
    $('.time', d.el).textContent = fmt(t);
    $('.remain', d.el).textContent = '-' + fmt(Math.max(0, total - t));
  }
  if (rec) $('#rec').textContent = '■ STOP  ' + mmss(Date.now() - recStart);
  requestAnimationFrame(frame);
}

// ---------- mixer ----------
const xf = $('#xf');
xf.oninput = () => {
  const v = +xf.value; // equal-power crossfade
  decks[0].xf = Math.cos(v * Math.PI / 2); decks[1].xf = Math.sin(v * Math.PI / 2);
  decks.forEach(applyGain);
};
xf.oninput();

// ---------- recording (master output of the song-file decks) ----------
let rec = null, recStart = 0, mix = null;
const mmss = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
function updateRecNote() { $('#recYT').hidden = !decks.some((d) => d.mode === 'yt'); }
if (!recDest || !window.MediaRecorder) {
  $('#rec').disabled = true;
  $('#recInfo').textContent = "This browser can't record. Update iOS or use Safari.";
}
$('#rec').onclick = () => {
  if (rec) { rec.stop(); return; }
  ctx.resume();
  const type = ['audio/mp4', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported?.(t));
  const chunks = [];
  rec = new MediaRecorder(recDest.stream, type ? { mimeType: type } : {});
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  rec.onstop = () => {
    const mime = rec.mimeType || type || 'audio/mp4';
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '.');
    mix = new File(chunks, `Pocket Decks mix ${stamp}.${mime.includes('webm') ? 'webm' : 'm4a'}`, { type: mime });
    rec = null;
    const a = $('#mixAudio');
    if (a.src) URL.revokeObjectURL(a.src);
    a.src = URL.createObjectURL(mix); a.hidden = false;
    $('#rec').textContent = '● REC'; $('#rec').classList.remove('on');
    $('#saveMix').hidden = false;
    $('#recInfo').textContent = `${mmss(Date.now() - recStart)} recorded. Save it before closing the app.`;
  };
  rec.start(1000);
  recStart = Date.now();
  $('#rec').classList.add('on'); $('#saveMix').hidden = true; $('#recInfo').textContent = '';
};
$('#saveMix').onclick = async () => {
  if (!mix) return;
  if (navigator.canShare?.({ files: [mix] })) {
    try { await navigator.share({ files: [mix], title: mix.name }); return; } // iPhone: "Save to Files"
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(mix); a.download = mix.name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
};

// ---------- beat analysis + auto remix ----------
function peaks(buf, n) {
  const ch = buf.getChannelData(0), step = Math.floor(ch.length / n), out = new Float32Array(n);
  for (let i = 0; i < n; i++) { let m = 0; for (let j = i * step; j < (i + 1) * step; j += 16) m = Math.max(m, Math.abs(ch[j])); out[i] = m; }
  return out;
}
function onsets(buf, whole = false) {
  // onset envelope of the kick range (~140 Hz low-pass), ~200 frames/s:
  // 60 s from ~30 s in for the quick tempo search, or the whole track for the fine fit
  const sr = buf.sampleRate, ch = buf.getChannelData(0), hop = Math.round(sr / 200);
  const start = whole ? 0 : Math.floor(sr * Math.min(30, buf.duration * 0.25));
  const n = Math.max(0, Math.min(Math.floor((ch.length - start) / hop), whole ? Infinity : 200 * 60));
  const env = new Float32Array(n), a = 1 - Math.exp(-2 * Math.PI * 140 / sr);
  let lp = 0, prev = 0;
  for (let i = 0; i < n; i++) {
    let e = 0;
    for (let j = 0; j < hop; j++) { lp += (ch[start + i * hop + j] - lp) * a; e += lp * lp; }
    e = Math.sqrt(e / hop); env[i] = Math.max(0, e - prev); prev = e;
  }
  return { env, n, startSec: start / sr, fps: sr / hop }; // real frame rate: hop is rounded
}
// Circular mean of onset energy around the beat period: its angle is where the beats fall,
// its length how consistently they fall there. Squaring lets the sharp attacks outweigh
// the smaller onsets in each kick's decay tail.
function phase(env, n, P) {
  let c = 0, s = 0;
  for (let i = 0; i < n; i++) {
    const w = env[i] * env[i], a = 2 * Math.PI * i / P;
    c += w * Math.cos(a); s += w * Math.sin(a);
  }
  return { o: ((Math.atan2(s, c) / (2 * Math.PI) * P) % P + P) % P, len: Math.hypot(c, s) };
}
function beatOffset(buf, bpm) {
  const { env, n, fps } = onsets(buf, true), P = 60 * fps / bpm;
  const rough = phase(env, n, P).o; // decay tails pull this a little late
  // so take the strongest onset within a quarter beat of each rough beat: that's the attack itself
  let c = 0, s = 0;
  for (let k = rough; k < n; k += P) {
    let best = -1;
    for (let i = Math.max(0, Math.round(k - P / 4)); i <= Math.min(n - 1, Math.round(k + P / 4)); i++)
      if (best < 0 || env[i] > env[best]) best = i;
    const w = env[best] * env[best], a = 2 * Math.PI * best / P;
    c += w * Math.cos(a); s += w * Math.sin(a);
  }
  return ((Math.atan2(s, c) / (2 * Math.PI) * P) % P + P) % P / fps;
}
// Fine tempo: a 0.1 BPM error drifts ~0.2 s over a 4-minute song, so try tempos in 0.005 steps
// around the estimate and keep the one where the beats line up best across the whole track.
function refineBPM(buf, bpm) {
  const { env, n, fps } = onsets(buf, true);
  let best = bpm, bestLen = -1;
  for (let b = bpm - 0.3; b <= bpm + 0.3; b += 0.005) {
    const { len } = phase(env, n, 60 * fps / b);
    if (len > bestLen) { bestLen = len; best = b; }
  }
  return Math.round(best * 1000) / 1000;
}
function detectBPM(buf) {
  // autocorrelate the onset envelope over 70-180 BPM
  const { env, n, fps } = onsets(buf);
  if (n < 400) return 0;
  const lo = Math.floor(60 * fps / 180), hi = Math.ceil(60 * fps / 70), score = [];
  let best = lo;
  for (let lag = lo; lag <= hi; lag++) {
    let s = 0; for (let i = 0; i + lag < n; i++) s += env[i] * env[i + lag];
    score[lag] = s / (n - lag); if (score[lag] > score[best]) best = lag;
  }
  const y0 = score[best - 1] ?? score[best], y2 = score[best + 1] ?? score[best];
  const lag = best + 0.5 * (y0 - y2) / (y0 - 2 * score[best] + y2 || 1);
  let bpm = 60 * fps / lag;
  while (bpm < 85) bpm *= 2; while (bpm > 180) bpm /= 2; // 85-180 keeps drum & bass at 174
  return refineBPM(buf, bpm);
}
const revCache = new WeakMap();
function reversed(buf) {
  let r = revCache.get(buf);
  if (r) return r;
  r = ctx.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const s = buf.getChannelData(c), o = r.getChannelData(c), n = s.length;
    for (let i = 0; i < n; i++) o[i] = s[n - 1 - i];
  }
  revCache.set(buf, r);
  return r;
}
// Auto remix: re-arranges the track on its beat grid. Every 4th bar gets a fill (stutter roll,
// reverse, beat repeat or gate), some bars are swapped with bars from 4 or 8 bars earlier,
// and every 16th bar builds with a high-pass sweep into the drop. Each seed gives a new version.
function remix(buf, bpm, seed) {
  bpm = refineBPM(buf, bpm); // also tightens a tapped tempo
  let r = seed >>> 0;
  const rnd = () => (r = (r * 1664525 + 1013904223) >>> 0) / 4294967296;
  const sr = buf.sampleRate, chs = buf.numberOfChannels, len = buf.length, fade = Math.round(0.003 * sr);
  const B = 60 / bpm, bar = 4 * B, off = beatOffset(buf, bpm), total = buf.duration, rev = reversed(buf);
  const bars = Math.floor((total - off) / bar), out = ctx.createBuffer(chs, len, sr), builds = [];
  // copies samples straight into the new track, with 3 ms fades so cuts don't click
  const clip = (src, from, dur, at, gain = 1) => {
    const f0 = Math.round(from * sr), n = Math.round(dur * sr), o0 = Math.round(at * sr);
    if (f0 < 0 || f0 + n > len || o0 + n > len) return;
    for (let c = 0; c < chs; c++) {
      const a = src.getChannelData(c), o = out.getChannelData(c);
      for (let i = 0; i < n; i++) o[o0 + i] += a[f0 + i] * gain * Math.min(1, i / fade, (n - i) / fade);
    }
  };
  if (off > 0.01) clip(buf, 0, off, 0);
  for (let b = 0; b < bars; b++) {
    const at = off + b * bar;
    let from = at;
    const back = 4 * (1 + Math.floor(rnd() * 2));
    if (b % 4 !== 3 && b >= back && rnd() < 0.2) from = at - back * bar;
    if (b % 16 === 15) builds.push(at);
    if (b % 4 !== 3) { clip(buf, from, bar, at); continue; }
    clip(buf, from, 2 * B, at);
    const t2 = at + 2 * B, fill = Math.floor(rnd() * 4);
    if (fill === 0) { // stutter roll on beat 1: 1/2, 1/4, 1/8 notes, getting louder
      let t = t2, i = 0;
      for (const [div, count] of [[2, 2], [4, 2], [8, 4]])
        for (let k = 0; k < count; k++, i++) { clip(buf, from, B / div, t, 0.6 + 0.05 * i); t += B / div; }
    } else if (fill === 1) clip(rev, total - (from + 4 * B), 2 * B, t2); // last two beats reversed
    else if (fill === 2) clip(buf, from, 2 * B, t2); // repeat beats 1-2
    else for (let i = 0; i < 8; i += 2) clip(buf, from + 2 * B + i * B / 4, B / 4, t2 + i * B / 4); // 16th gate
  }
  const tail = off + bars * bar;
  if (total - tail > 0.01) clip(buf, tail, total - tail, tail);
  if (!builds.length) return Promise.resolve(out);
  // every 16th bar: a high-pass sweep up into the drop. Only the build bars go through a filter;
  // they're spliced back with a short crossfade, so the drop comes straight from the clean track
  // (snapping a filter shut on a loud kick makes it overshoot).
  const oc = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(chs, len, sr);
  for (const at of builds) {
    const src = oc.createBufferSource(), hp = oc.createBiquadFilter();
    src.buffer = out; hp.type = 'highpass'; hp.Q.value = -3; // no resonant bump at the cutoff
    hp.frequency.setValueAtTime(10, at);
    hp.frequency.exponentialRampToValueAtTime(1200, at + bar);
    src.connect(hp).connect(oc.destination); src.start(at, at, bar);
  }
  return oc.startRendering().then((swept) => {
    const x = Math.round(0.005 * sr);
    for (const at of builds) {
      const s0 = Math.round(at * sr), n = Math.min(Math.round(bar * sr), len - s0);
      for (let c = 0; c < chs; c++) {
        const o = out.getChannelData(c), w = swept.getChannelData(c);
        for (let i = 0; i < n; i++) {
          const k = Math.min(1, i / x, (n - i) / x); // 5 ms crossfade in and out
          o[s0 + i] = w[s0 + i] * k + o[s0 + i] * (1 - k);
        }
      }
    }
    return out;
  });
}

// ---------- YouTube library: search, playlists, liked ----------
const lib = $('#lib'), rowsEl = $('#rows'), libMsg = $('#libMsg');
let libDeck = 0, tab = 'search', inList = null, tokenClient = null;
const say = (m) => (libMsg.textContent = m);

async function api(path, params) {
  const t = await getToken(), key = store.get('apiKey');
  if (!t && !key) throw new Error('Sign in with Google (top right) to search YouTube and see your playlists.');
  const q = new URLSearchParams(t ? params : { ...params, key });
  const r = await fetch(`https://www.googleapis.com/youtube/v3/${path}?${q}`, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
  const j = await r.json();
  if (r.status === 401) { forgetToken(); throw new Error('Your Google sign-in ran out. Tap Sign in with Google again.'); }
  if (!r.ok) throw new Error(j.error?.message ?? `YouTube error ${r.status}`);
  return j.items;
}
const unescape = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const toRow = (it, id) => ({ id, title: unescape(it.snippet.title), sub: it.snippet.videoOwnerChannelTitle ?? it.snippet.channelTitle ?? '', thumb: it.snippet.thumbnails?.default?.url });
const yt = {
  search: (q) => api('search', { part: 'snippet', type: 'video', videoEmbeddable: 'true', maxResults: '25', q }).then((xs) => xs.map((x) => toRow(x, x.id.videoId))),
  playlists: () => api('playlists', { part: 'snippet', mine: 'true', maxResults: '50' }).then((xs) => xs.map((x) => toRow(x, x.id))),
  tracks: (id) => api('playlistItems', { part: 'snippet', playlistId: id, maxResults: '50' }).then((xs) => xs
    .filter((x) => x.snippet.resourceId?.videoId && !/^(Private|Deleted) video$/.test(x.snippet.title))
    .map((x) => toRow(x, x.snippet.resourceId.videoId))),
  liked: () => api('videos', { part: 'snippet', myRating: 'like', maxResults: '50' }).then((xs) => xs.map((x) => toRow(x, x.id))),
};

async function run(p) {
  rowsEl.replaceChildren(); say('Loading…');
  try {
    const rows = await p();
    rowsEl.replaceChildren(...rows.map((r) => {
      const li = document.createElement('li'), b = document.createElement('button');
      b.className = 'row';
      b.innerHTML = '<img alt="" loading="lazy"><div><b></b><span></span></div>';
      if (r.thumb) $('img', b).src = r.thumb;
      $('b', b).textContent = r.title; $('span', b).textContent = r.sub;
      b.onclick = () => pick(r);
      li.append(b); return li;
    }));
    say(rows.length ? '' : 'Nothing here.');
  } catch (e) { say(e.message); }
}
function pick(r) {
  if (tab === 'playlists' && !inList) { inList = r.title; $('#back').hidden = false; $('#back').textContent = `‹ Playlists · ${r.title}`; return run(() => yt.tracks(r.id)); }
  lib.close();
  loadYouTube(decks[libDeck], r);
}
function showTab(t) {
  tab = t; inList = null;
  $$('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  $('#searchForm').hidden = t !== 'search';
  $('#setup').hidden = t !== 'setup';
  $('#rows').hidden = t === 'setup';
  $('#back').hidden = true;
  rowsEl.replaceChildren(); say('');
  if (!navigator.onLine && t !== 'setup') return say("You're offline. YouTube needs internet; song files still work.");
  if (renewing() && t !== 'setup') return say(tokenClient ? 'Renewing your Google sign-in…' : 'Getting Google sign-in ready. Tap Sign in with Google.');
  if (!signedIn() && t !== 'setup' && !(t === 'search' && store.get('apiKey')))
    return say('Sign in with Google (top right) to search YouTube and see your playlists and liked songs. You only need to do this once.');
  if (t === 'playlists') run(yt.playlists);
  if (t === 'liked') run(yt.liked);
}
function openLib(i) {
  libDeck = i;
  lib.showModal();
  if (renewing() && tokenClient) tokenClient.requestAccessToken({ prompt: '' }); // already allowed: Google's window opens and closes by itself
  showTab(tab);
  prepSignIn();
}
$$('.tabs button').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
$('#libClose').onclick = () => lib.close();
$('#back').onclick = () => showTab('playlists');
$('#searchForm').onsubmit = (e) => { e.preventDefault(); const q = $('#q').value.trim(); if (q) { $('#q').blur(); run(() => yt.search(q)); } };
for (const k of ['apiKey', 'clientId']) {
  $('#' + k).value = store.get(k);
  $('#' + k).onchange = (e) => { store.set(k, e.target.value.trim()); tokenClient = null; prepSignIn(); };
}
$('#originHint').textContent = $('#originHint2').textContent = location.origin;

// ---------- Google sign-in, remembered ----------
// Installed iPhone app: Google's sign-in page opens in Safari's in-app sheet (Google blocks it inside
// the app's own web view), returns through the app's URL scheme, and gives a refresh token. The app
// keeps that, so you sign in once. In Safari / Home Screen there are no refresh tokens: the sign-in
// is kept for its hour, then one tap renews it.
const native = !!window.Capacitor?.isNativePlatform?.();
const Cap = window.Capacitor?.Plugins ?? {};
const SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
const iosRedirect = () => GOOGLE_IOS_CLIENT_ID.split('.').reverse().join('.') + ':/oauthredirect';
const b64url = (a) => btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
let pkce = null;

const tokenValid = () => store.get('token') && +store.get('tokenExp') > Date.now() + 60000;
const signedIn = () => !!(tokenValid() || store.get(native ? 'refresh' : 'webSignedIn'));
const renewing = () => !native && !tokenValid() && !!store.get('webSignedIn');
function saveToken(t, secs) {
  store.set('token', t); store.set('tokenExp', String(Date.now() + secs * 1000));
  signinUI();
}
function forgetToken() { store.set('token', ''); store.set('tokenExp', ''); signinUI(); }
function signinUI() { $('#signin').textContent = signedIn() ? 'Sign out' : 'Sign in with Google'; }
async function googleToken(params) {
  // CapacitorHttp goes through iOS itself, so Google's token endpoint needs no browser CORS
  const r = await Cap.CapacitorHttp.post({
    url: 'https://oauth2.googleapis.com/token',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    data: new URLSearchParams({ client_id: GOOGLE_IOS_CLIENT_ID, ...params }).toString(),
  });
  return typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
}
async function getToken() {
  if (tokenValid()) return store.get('token');
  const refresh = store.get('refresh');
  if (native && refresh && navigator.onLine) {
    const r = await googleToken({ grant_type: 'refresh_token', refresh_token: refresh });
    if (r.access_token) { saveToken(r.access_token, r.expires_in); return r.access_token; }
    if (r.error === 'invalid_grant') store.set('refresh', ''); // revoked or expired: sign in again
  }
  forgetToken();
  return null;
}
async function nativeSignIn() {
  const rand = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));
  const verifier = rand(48), state = rand(16);
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  pkce = { verifier, state };
  const q = new URLSearchParams({ client_id: GOOGLE_IOS_CLIENT_ID, redirect_uri: iosRedirect(), response_type: 'code',
    scope: SCOPE, code_challenge: challenge, code_challenge_method: 'S256', state });
  await Cap.Browser.open({ url: 'https://accounts.google.com/o/oauth2/v2/auth?' + q });
}
if (native) Cap.App?.addListener('appUrlOpen', async ({ url }) => {
  if (!url.startsWith(iosRedirect().split(':')[0] + ':')) return;
  Cap.Browser.close().catch(() => {});
  const p = new URLSearchParams(url.split('?')[1] || '');
  if (p.get('error')) return say(`Sign-in cancelled (${p.get('error')}).`);
  if (!pkce || p.get('state') !== pkce.state) return say("Sign-in didn't finish. Tap Sign in with Google again.");
  say('Signing in…');
  const r = await googleToken({ grant_type: 'authorization_code', code: p.get('code'), code_verifier: pkce.verifier, redirect_uri: iosRedirect() });
  pkce = null;
  if (!r.access_token) return say(`Google sign-in failed: ${r.error_description || r.error}`);
  if (r.refresh_token) store.set('refresh', r.refresh_token);
  saveToken(r.access_token, r.expires_in);
  showTab(tab === 'setup' ? 'playlists' : tab);
});

// Safari / Home Screen: Google Identity Services. The token client is prepared when the library
// opens, so the tap on "Sign in" can open Google's window straight away (Safari blocks it otherwise).
let gisLoad;
const webClientId = () => GOOGLE_WEB_CLIENT_ID || store.get('clientId');
function prepSignIn() {
  if (native || !webClientId() || tokenClient || !navigator.onLine) return;
  gisLoad ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = res; s.onerror = () => { gisLoad = null; rej(); };
    document.head.append(s);
  });
  gisLoad.then(() => {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: webClientId(), scope: SCOPE,
      callback: (r) => {
        if (!r.access_token) { store.set('webSignedIn', ''); signinUI(); return say("Sign-in didn't finish. Tap Sign in with Google."); }
        store.set('webSignedIn', '1'); saveToken(r.access_token, r.expires_in); showTab(tab === 'setup' ? 'playlists' : tab);
      },
      error_callback: (e) => { store.set('webSignedIn', ''); signinUI(); say(`Sign-in didn't finish (${e.message || e.type}). Tap Sign in with Google.`); },
    });
  }, () => {});
}
$('#signin').onclick = () => {
  if (renewing() && tokenClient) return tokenClient.requestAccessToken({ prompt: '' });
  if (signedIn()) { store.set('refresh', ''); store.set('webSignedIn', ''); forgetToken(); return showTab(tab); }
  if (native) {
    if (!GOOGLE_IOS_CLIENT_ID) return say('This build has no Google client ID yet (see README).');
    return nativeSignIn().catch((e) => say(`Couldn't open Google sign-in: ${e.message}`));
  }
  if (!webClientId()) { showTab('setup'); return say('Add your Google OAuth client ID in Setup first.'); }
  if (!tokenClient) { prepSignIn(); return say('Getting Google sign-in ready. Tap Sign in again in a second.'); }
  tokenClient.requestAccessToken();
};
signinUI();
if (store.get('webSignedIn')) prepSignIn();
// both apps have their Google client ID built in: no Setup needed (it stays for a copy built without one)
if (native ? GOOGLE_IOS_CLIENT_ID : GOOGLE_WEB_CLIENT_ID) $('.tabs [data-tab=setup]').hidden = true;

// ---------- Get the app ----------
const getDlg = $('#getDlg');
const homeScreenApp = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
$('#homeBox').hidden = homeScreenApp; $('#homeDone').hidden = !homeScreenApp;
$('#getBtn').hidden = native; // already the installed app
$('#getBtn').onclick = () => getDlg.showModal();
$('.getapp').onclick = () => getDlg.showModal();
$('#getClose').onclick = () => getDlg.close();

// ---------- offline + install ----------
const onlineUI = () => { $('#offline').hidden = navigator.onLine; };
addEventListener('online', onlineUI); addEventListener('offline', onlineUI); onlineUI();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');

requestAnimationFrame(frame);
