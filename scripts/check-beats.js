// Checks the tempo and beat-grid detection the auto remix cuts on, using synthetic kick tracks.
// The grid must still be on the beat at the END of a 4-minute track, where tempo errors add up.
// Run: node scripts/check-beats.js
const src = require('fs').readFileSync(__dirname + '/../web/app.js', 'utf8');
const code = src.slice(src.indexOf('function onsets'), src.indexOf('const revCache'));
const { detectBPM, beatOffset } = new Function(code + 'return { detectBPM, beatOffset };')();

function kickTrack(bpm, offset, seconds, sr = 44100) {
  const ch = new Float32Array(seconds * sr);
  for (let k = 0, t = offset; t < seconds - 0.2; t = offset + ++k * 60 / bpm) {
    const at = Math.round(t * sr);
    for (let i = 0; i < 0.15 * sr; i++) { // pitch-swept kick, like a real drum machine
      const f = 42 + 108 * Math.exp(-i / (0.03 * sr));
      ch[at + i] = Math.sin(2 * Math.PI * f * i / sr) * Math.exp(-i / (0.06 * sr));
    }
  }
  return { sampleRate: sr, duration: seconds, getChannelData: () => ch };
}

for (const [bpm, off, secs] of [[124, 0.3, 240], [128, 0.05, 200], [96, 0.4, 180], [140, 0.33, 240], [174, 0.1, 150]]) {
  const buf = kickTrack(bpm, off, secs);
  const got = detectBPM(buf), gotOff = beatOffset(buf, got);
  const lastBeat = Math.floor((secs - 1 - off) * bpm / 60);
  const drift = (gotOff + lastBeat * 60 / got) - (off + lastBeat * 60 / bpm); // grid error at the last beat
  console.log(`${bpm} BPM @ ${off}s, ${secs}s -> ${got} BPM @ ${gotOff.toFixed(3)}s, drift at end ${(drift * 1000).toFixed(1)} ms`);
  if (Math.abs(gotOff - off) > 0.01) throw new Error(`first beat off by ${((gotOff - off) * 1000).toFixed(0)} ms`);
  if (Math.abs(drift) > 0.015) throw new Error(`grid drifts ${(drift * 1000).toFixed(0)} ms by the end`);
}
console.log('ok');
