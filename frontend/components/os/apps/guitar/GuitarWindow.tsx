"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, ExternalLink, Guitar, Mic, MicOff, Pause, Play, Sparkles, Volume2 } from "lucide-react";
import ChatMarkdown from "@/components/agent/ChatMarkdown";
import {
  CHORDS,
  EXAMPLE_TABS,
  OPEN_STRINGS,
  detectPitch,
  noteFromFreq,
  parseTab,
  type Chord,
  type TabNote,
} from "./guitarData";
import { LESSONS, type Lesson } from "./courseData";

/**
 * Lernen › Gitarre — tuner (microphone), chord library, metronome, tab viewer and practice plan by Elly.
 */

type Tab = "course" | "tuner" | "chords" | "metronome" | "tabs" | "plan";

const ACCENT = "#d97706";
const card = { borderColor: "var(--os-border-soft)", background: "var(--bg-surface)" } as const;

// ── Audio helpers ────────────────────────────────────────────────────────────

let sharedCtx: AudioContext | null = null;
function audioCtx(): AudioContext {
  if (!sharedCtx) sharedCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  if (sharedCtx.state === "suspended") void sharedCtx.resume();
  return sharedCtx;
}

function pluck(freq: number, when = 0, duration = 1.6, volume = 0.22) {
  const ctx = audioCtx();
  const t = ctx.currentTime + when;
  const osc = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  osc.type = "triangle";
  osc2.type = "sine";
  osc.frequency.value = freq;
  osc2.frequency.value = freq * 2;
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(freq * 8, t);
  filter.frequency.exponentialRampToValueAtTime(Math.max(freq * 1.5, 200), t + duration);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(volume, t + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  const g2 = ctx.createGain();
  g2.gain.value = 0.25;
  osc.connect(filter);
  osc2.connect(g2).connect(filter);
  filter.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc2.start(t);
  osc.stop(t + duration + 0.05);
  osc2.stop(t + duration + 0.05);
}

const fretFreq = (string: number, fret: number) => OPEN_STRINGS[string]!.freq * Math.pow(2, fret / 12);

function playNotes(notes: TabNote[], strum = 0.035) {
  [...notes].sort((a, b) => a.string - b.string).forEach((n, i) => pluck(fretFreq(n.string, n.fret), i * strum));
}

// ── Chord diagram ────────────────────────────────────────────────────────────

function ChordDiagram({ chord, size = 1 }: { chord: Chord; size?: number }) {
  const played = chord.frets.filter((f) => f > 0);
  const minFret = played.length ? Math.min(...played) : 1;
  const base = Math.max(...chord.frets) > 4 ? minFret : 1;
  const w = 108 * size, h = 132 * size, left = 18 * size, top = 26 * size, sx = 15 * size, sy = 19 * size;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      {base === 1 ? <rect x={left} y={top - 3 * size} width={sx * 5} height={3.5 * size} fill="var(--text-primary)" /> : (
        <text x={4 * size} y={top + sy * 0.7} fontSize={10 * size} fill="var(--text-muted)">{base}</text>
      )}
      {Array.from({ length: 6 }, (_, f) => (
        <line key={`f${f}`} x1={left} x2={left + sx * 5} y1={top + f * sy} y2={top + f * sy} stroke="var(--text-muted)" strokeWidth={1} />
      ))}
      {Array.from({ length: 6 }, (_, s) => (
        <line key={`s${s}`} x1={left + s * sx} x2={left + s * sx} y1={top} y2={top + sy * 5} stroke="var(--text-secondary)" strokeWidth={1 + (5 - s) * 0.15} />
      ))}
      {chord.barre ? (
        <rect
          x={left + chord.barre.from * sx - 5 * size}
          y={top + (chord.barre.fret - base + 0.5) * sy - 5 * size}
          width={(chord.barre.to - chord.barre.from) * sx + 10 * size}
          height={10 * size}
          rx={5 * size}
          fill={ACCENT}
        />
      ) : null}
      {chord.frets.map((fret, s) => {
        const x = left + s * sx;
        if (fret < 0) return <text key={s} x={x} y={top - 9 * size} textAnchor="middle" fontSize={10 * size} fill="var(--text-muted)">×</text>;
        if (fret === 0) return <circle key={s} cx={x} cy={top - 12 * size} r={3.5 * size} fill="none" stroke="var(--text-secondary)" />;
        const y = top + (fret - base + 0.5) * sy;
        return (
          <g key={s}>
            <circle cx={x} cy={y} r={6 * size} fill={ACCENT} />
            {chord.fingers?.[s] ? (
              <text x={x} y={y + 3.5 * size} textAnchor="middle" fontSize={8.5 * size} fill="#fff" fontWeight={700}>{chord.fingers[s]}</text>
            ) : null}
          </g>
        );
      })}
      {["E", "A", "D", "G", "H", "e"].map((n, s) => (
        <text key={n} x={left + s * sx} y={h - 4 * size} textAnchor="middle" fontSize={8 * size} fill="var(--text-muted)">{n}</text>
      ))}
    </svg>
  );
}

// ── Fretboard ────────────────────────────────────────────────────────────────

function Fretboard({ notes }: { notes: TabNote[] }) {
  const frets = 15, w = 760, h = 150, left = 52, top = 18, fw = (w - left - 10) / frets, sh = (h - top - 22) / 5;
  const markers = [3, 5, 7, 9, 12, 15];
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ maxWidth: w }}>
      <rect x={left} y={top} width={fw * frets} height={sh * 5} fill="color-mix(in srgb, #d97706 7%, transparent)" rx={3} />
      {markers.map((m) => (
        <circle key={m} cx={left + (m - 0.5) * fw} cy={top + sh * 2.5} r={m === 12 ? 4 : 3} fill="var(--os-border-soft)" />
      ))}
      {Array.from({ length: frets + 1 }, (_, f) => (
        <line key={f} x1={left + f * fw} x2={left + f * fw} y1={top} y2={top + sh * 5} stroke={f === 0 ? "var(--text-primary)" : "var(--text-muted)"} strokeWidth={f === 0 ? 4 : 1} />
      ))}
      {[5, 4, 3, 2, 1, 0].map((s, row) => (
        <g key={s}>
          <line x1={left} x2={left + fw * frets} y1={top + row * sh} y2={top + row * sh} stroke="var(--text-secondary)" strokeWidth={1 + s * 0.25} />
          <text x={9} y={top + row * sh + 4} fontSize={11} fill="var(--text-muted)" textAnchor="middle">{["E", "A", "D", "G", "H", "e"][s]}</text>
        </g>
      ))}
      {Array.from({ length: frets }, (_, f) => (
        <text key={`n${f}`} x={left + (f + 0.5) * fw} y={h - 4} fontSize={9} fill="var(--text-muted)" textAnchor="middle">{f + 1}</text>
      ))}
      {notes.map((n, i) => {
        const row = 5 - n.string;
        const cx = n.fret === 0 ? left - 16 : left + (n.fret - 0.5) * fw;
        const cy = top + row * sh;
        return (
          <g key={i}>
            <circle cx={cx} cy={cy} r={10} fill={ACCENT} />
            <text x={cx} y={cy + 4} fontSize={10.5} fill="#fff" fontWeight={700} textAnchor="middle">{n.fret}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Tuner ────────────────────────────────────────────────────────────────────

function Tuner() {
  const [listening, setListening] = useState(false);
  const [freq, setFreq] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const smoothRef = useRef<number[]>([]);

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setListening(false);
  }, []);

  useEffect(() => stop, [stop]);

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      streamRef.current = stream;
      const ctx = audioCtx();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 4096;
      src.connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      setListening(true);
      const loop = () => {
        analyser.getFloatTimeDomainData(buf);
        const f = detectPitch(buf, ctx.sampleRate);
        if (f > 0) {
          const arr = [...smoothRef.current, f].slice(-5);
          smoothRef.current = arr;
          const sorted = [...arr].sort((a, b) => a - b);
          setFreq(sorted[Math.floor(sorted.length / 2)]!);
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      loop();
    } catch {
      setError("Kein Mikrofonzugriff. Erlaube das Mikrofon im Browser (Schloss-Symbol in der Adresszeile).");
    }
  }, []);

  const note = freq ? noteFromFreq(freq) : null;
  const nearest = freq
    ? OPEN_STRINGS.map((s, i) => ({ i, d: Math.abs(1200 * Math.log2(freq / s.freq)) })).sort((a, b) => a.d - b.d)[0]!
    : null;
  const cents = note?.cents ?? 0;
  const inTune = note !== null && Math.abs(cents) <= 5;

  return (
    <div className="grid gap-4 md:grid-cols-[1.2fr_1fr]">
      <div className="rounded-2xl border p-5 text-center" style={card}>
        <div className="text-[64px] font-bold leading-none tabular-nums" style={{ color: inTune ? "#16a34a" : "var(--text-primary)" }}>
          {note ? note.name : "–"}
          <span className="text-[22px] align-top text-[color:var(--text-muted)]">{note ? note.octave : ""}</span>
        </div>
        <div className="mt-1 text-[12px] text-[color:var(--text-muted)]">{freq ? `${freq.toFixed(1)} Hz` : listening ? "Spiel eine Saite an…" : "Stimmgerät ist aus"}</div>
        <div className="relative mx-auto mt-5 h-10 max-w-[360px]">
          <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full" style={{ background: "linear-gradient(90deg,#dc2626,#f59e0b 35%,#16a34a 50%,#f59e0b 65%,#dc2626)" }} />
          <div className="absolute top-0 h-10 w-1 rounded-full transition-all duration-150" style={{ left: `calc(${50 + Math.max(-50, Math.min(50, cents))}% - 2px)`, background: "var(--text-primary)" }} />
        </div>
        <div className="mt-2 text-[13px] font-semibold" style={{ color: inTune ? "#16a34a" : "var(--text-secondary)" }}>
          {!note ? "" : inTune ? "✓ Gestimmt" : cents < 0 ? `${Math.abs(cents)} Cent zu tief – Saite spannen` : `${cents} Cent zu hoch – Saite lockern`}
        </div>
        <button
          onClick={() => (listening ? stop() : void start())}
          className="mt-5 inline-flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-semibold text-white"
          style={{ background: listening ? "#64748b" : ACCENT }}
        >
          {listening ? <MicOff size={15} /> : <Mic size={15} />} {listening ? "Stimmgerät stoppen" : "Stimmgerät starten"}
        </button>
        {error ? <p className="mt-3 text-[12px] text-red-500">{error}</p> : null}
      </div>
      <div className="rounded-2xl border p-5" style={card}>
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Standardstimmung · Referenzton</p>
        <div className="mt-3 grid grid-cols-6 gap-2">
          {OPEN_STRINGS.map((s, i) => (
            <button
              key={i}
              onClick={() => pluck(s.freq, 0, 2.2, 0.3)}
              className="flex flex-col items-center rounded-xl border py-3 text-[18px] font-bold"
              style={{ borderColor: nearest?.i === i && note ? ACCENT : "var(--os-border-soft)", color: "var(--text-primary)" }}
            >
              {s.name}
              <span className="text-[10px] font-normal text-[color:var(--text-muted)]">{6 - i}. Saite</span>
            </button>
          ))}
        </div>
        <p className="mt-4 text-[12px] leading-relaxed text-[color:var(--text-secondary)]">
          Tippe auf eine Saite, um den Referenzton zu hören, oder starte das Stimmgerät und spiel die Saite einzeln an.
          Grün heißt: auf ±5 Cent genau. Die tiefste Saite ist E (6. Saite), die höchste e (1. Saite).
        </p>
      </div>
    </div>
  );
}

// ── Chords ───────────────────────────────────────────────────────────────────

function Chords() {
  const groups = ["Dur", "Moll", "Sept", "Sus/Add", "Barré"] as const;
  const [group, setGroup] = useState<(typeof groups)[number] | "Alle">("Alle");
  const [selected, setSelected] = useState<Chord>(CHORDS[0]!);
  const list = group === "Alle" ? CHORDS : CHORDS.filter((c) => c.group === group);
  const strum = (c: Chord) => playNotes(c.frets.map((fret, string) => ({ string, fret })).filter((n) => n.fret >= 0));
  return (
    <div className="grid gap-4 md:grid-cols-[1fr_280px]">
      <div>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {(["Alle", ...groups] as const).map((g) => (
            <button key={g} onClick={() => setGroup(g)} className="rounded-full border px-3 py-1 text-[12px]"
              style={{ borderColor: group === g ? ACCENT : "var(--os-border-soft)", color: group === g ? ACCENT : "var(--text-secondary)" }}>
              {g}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {list.map((c) => (
            <button key={c.name} onClick={() => { setSelected(c); strum(c); }} className="flex flex-col items-center rounded-xl border p-1.5"
              style={{ borderColor: selected.name === c.name ? ACCENT : "var(--os-border-soft)", background: "var(--bg-surface)" }}>
              <span className="text-[13px] font-bold text-[color:var(--text-primary)]">{c.name}</span>
              <ChordDiagram chord={c} size={0.72} />
            </button>
          ))}
        </div>
      </div>
      <div className="rounded-2xl border p-4 text-center" style={card}>
        <p className="text-[28px] font-bold text-[color:var(--text-primary)]">{selected.name}</p>
        <div className="flex justify-center"><ChordDiagram chord={selected} size={1.7} /></div>
        <button onClick={() => strum(selected)} className="mt-2 inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-[12px] font-semibold text-white" style={{ background: ACCENT }}>
          <Volume2 size={14} /> Anhören
        </button>
        <p className="mt-3 text-left text-[11px] leading-relaxed text-[color:var(--text-muted)]">
          Zahlen = Finger (1 Zeige-, 2 Mittel-, 3 Ring-, 4 kleiner Finger). ○ leere Saite spielen, × nicht anschlagen.
          Im Deutschen heißt der Ton B „H“ – also H7 und Hm.
        </p>
      </div>
    </div>
  );
}

// ── Metronome ────────────────────────────────────────────────────────────────

function Metronome() {
  const [bpm, setBpm] = useState(80);
  const [beats, setBeats] = useState(4);
  const [running, setRunning] = useState(false);
  const [beat, setBeat] = useState(-1);
  const bpmRef = useRef(bpm);
  const beatsRef = useRef(beats);
  const timerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const queueRef = useRef<Array<{ beat: number; time: number }>>([]);
  const nextRef = useRef({ time: 0, beat: 0 });
  const tapsRef = useRef<number[]>([]);
  bpmRef.current = bpm;
  beatsRef.current = beats;

  const stop = useCallback(() => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    timerRef.current = null;
    queueRef.current = [];
    setRunning(false);
    setBeat(-1);
  }, []);
  useEffect(() => stop, [stop]);

  const start = useCallback(() => {
    const ctx = audioCtx();
    nextRef.current = { time: ctx.currentTime + 0.06, beat: 0 };
    const click = (time: number, accent: boolean) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.frequency.value = accent ? 1600 : 1000;
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.3, time + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
      osc.connect(g).connect(ctx.destination);
      osc.start(time);
      osc.stop(time + 0.06);
    };
    timerRef.current = window.setInterval(() => {
      while (nextRef.current.time < ctx.currentTime + 0.12) {
        const { time, beat: b } = nextRef.current;
        click(time, b === 0);
        queueRef.current.push({ beat: b, time });
        nextRef.current = { time: time + 60 / bpmRef.current, beat: (b + 1) % beatsRef.current };
      }
    }, 25);
    const draw = () => {
      const q = queueRef.current;
      while (q.length && q[0]!.time <= ctx.currentTime) setBeat(q.shift()!.beat);
      rafRef.current = requestAnimationFrame(draw);
    };
    draw();
    setRunning(true);
  }, []);

  const tap = () => {
    const now = performance.now();
    const taps = [...tapsRef.current.filter((t) => now - t < 2500), now].slice(-5);
    tapsRef.current = taps;
    if (taps.length >= 2) {
      const avg = (taps[taps.length - 1]! - taps[0]!) / (taps.length - 1);
      setBpm(Math.max(30, Math.min(240, Math.round(60000 / avg))));
    }
  };

  const label = bpm < 60 ? "Largo" : bpm < 76 ? "Adagio" : bpm < 108 ? "Andante/Moderato" : bpm < 156 ? "Allegro" : "Presto";
  return (
    <div className="mx-auto max-w-[520px] rounded-2xl border p-6 text-center" style={card}>
      <div className="text-[64px] font-bold leading-none tabular-nums text-[color:var(--text-primary)]">{bpm}</div>
      <div className="text-[12px] text-[color:var(--text-muted)]">BPM · {label}</div>
      <div className="my-5 flex justify-center gap-3">
        {Array.from({ length: beats }, (_, i) => (
          <span key={i} className="h-5 w-5 rounded-full transition-transform duration-75"
            style={{ background: beat === i ? (i === 0 ? ACCENT : "var(--text-primary)") : "var(--os-border-soft)", transform: beat === i ? "scale(1.3)" : "scale(1)" }} />
        ))}
      </div>
      <input type="range" min={30} max={240} value={bpm} onChange={(e) => setBpm(Number(e.target.value))} className="w-full" style={{ accentColor: ACCENT }} />
      <div className="mt-3 flex items-center justify-center gap-2">
        {[-5, -1, 1, 5].map((d) => (
          <button key={d} onClick={() => setBpm((b) => Math.max(30, Math.min(240, b + d)))} className="rounded-lg border px-3 py-1 text-[12px] text-[color:var(--text-primary)]" style={{ borderColor: "var(--os-border-soft)" }}>
            {d > 0 ? `+${d}` : d}
          </button>
        ))}
        <button onClick={tap} className="rounded-lg border px-3 py-1 text-[12px] text-[color:var(--text-primary)]" style={{ borderColor: "var(--os-border-soft)" }}>Tap</button>
      </div>
      <div className="mt-3 flex items-center justify-center gap-2 text-[12px] text-[color:var(--text-muted)]">
        Takt:
        {[2, 3, 4, 6].map((b) => (
          <button key={b} onClick={() => setBeats(b)} className="rounded-lg border px-2.5 py-0.5"
            style={{ borderColor: beats === b ? ACCENT : "var(--os-border-soft)", color: beats === b ? ACCENT : "var(--text-secondary)" }}>{b}/4</button>
        ))}
      </div>
      <button onClick={() => (running ? stop() : start())} className="mt-5 inline-flex items-center gap-2 rounded-xl px-5 py-2 text-[13px] font-semibold text-white" style={{ background: running ? "#64748b" : ACCENT }}>
        {running ? <Pause size={15} /> : <Play size={15} />} {running ? "Stopp" : "Start"}
      </button>
    </div>
  );
}

// ── Tabs ─────────────────────────────────────────────────────────────────────

function Tabs() {
  const [text, setText] = useState(EXAMPLE_TABS[0]!.tab);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [bpm, setBpm] = useState(70);
  const timer = useRef<number | null>(null);
  const parsed = useMemo(() => parseTab(text), [text]);
  const step = parsed.steps[index];

  useEffect(() => { setIndex(0); }, [text]);
  useEffect(() => () => { if (timer.current) window.clearInterval(timer.current); }, []);

  const go = useCallback((i: number, sound = true) => {
    const s = parsed.steps[i];
    if (!s) return;
    setIndex(i);
    if (sound) playNotes(s.notes, 0.03);
  }, [parsed.steps]);

  const togglePlay = () => {
    if (playing) {
      if (timer.current) window.clearInterval(timer.current);
      setPlaying(false);
      return;
    }
    let i = index;
    go(i);
    setPlaying(true);
    timer.current = window.setInterval(() => {
      i += 1;
      if (i >= parsed.steps.length) {
        if (timer.current) window.clearInterval(timer.current);
        setPlaying(false);
        return;
      }
      go(i);
    }, 60000 / bpm);
  };

  const marks = new Map<number, Array<{ col: number; len: number }>>();
  step?.marks.forEach((m) => marks.set(m.line, [...(marks.get(m.line) ?? []), { col: m.col, len: m.len }]));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-[color:var(--text-muted)]">Beispiele (gemeinfrei):</span>
        {EXAMPLE_TABS.map((t) => (
          <button key={t.title} onClick={() => setText(t.tab)} title={t.note} className="rounded-full border px-3 py-1 text-[12px] text-[color:var(--text-secondary)]" style={{ borderColor: "var(--os-border-soft)" }}>
            {t.title}
          </button>
        ))}
      </div>
      <div className="rounded-2xl border p-3" style={card}>
        <Fretboard notes={step?.notes ?? []} />
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          <button onClick={() => go(Math.max(0, index - 1))} className="rounded-lg border p-1.5" style={{ borderColor: "var(--os-border-soft)" }}><ChevronLeft size={16} /></button>
          <button onClick={togglePlay} disabled={!parsed.steps.length} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50" style={{ background: playing ? "#64748b" : ACCENT }}>
            {playing ? <Pause size={14} /> : <Play size={14} />} {playing ? "Pause" : "Abspielen"}
          </button>
          <button onClick={() => go(Math.min(parsed.steps.length - 1, index + 1))} className="rounded-lg border p-1.5" style={{ borderColor: "var(--os-border-soft)" }}><ChevronRight size={16} /></button>
          <span className="text-[12px] tabular-nums text-[color:var(--text-muted)]">Schritt {parsed.steps.length ? index + 1 : 0}/{parsed.steps.length}</span>
          <label className="ml-2 flex items-center gap-2 text-[12px] text-[color:var(--text-muted)]">
            Tempo <input type="range" min={30} max={160} value={bpm} onChange={(e) => setBpm(Number(e.target.value))} style={{ accentColor: ACCENT }} /> {bpm} BPM
          </label>
        </div>
        {step ? (
          <p className="mt-1 text-center text-[12px] text-[color:var(--text-secondary)]">
            {step.notes.map((n) => `${["E", "A", "D", "G", "H", "e"][n.string]}-Saite ${n.fret === 0 ? "leer" : `${n.fret}. Bund`}`).join(" · ")}
          </p>
        ) : null}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="overflow-x-auto rounded-2xl border p-3" style={card}>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Tab (aktueller Schritt markiert – Klick auf eine Zahl springt hin)</p>
          <pre className="font-mono text-[12.5px] leading-[1.5] text-[color:var(--text-primary)]">
            {parsed.lines.map((line, li) => {
              const ms = marks.get(li) ?? [];
              if (!ms.length) return <div key={li}>{line || " "}</div>;
              const parts: React.ReactNode[] = [];
              let pos = 0;
              ms.sort((a, b) => a.col - b.col).forEach((m, k) => {
                parts.push(line.slice(pos, m.col));
                parts.push(<mark key={k} style={{ background: ACCENT, color: "#fff", borderRadius: 3 }}>{line.slice(m.col, m.col + m.len)}</mark>);
                pos = m.col + m.len;
              });
              parts.push(line.slice(pos));
              return <div key={li}>{parts}</div>;
            })}
          </pre>
        </div>
        <div className="rounded-2xl border p-3" style={card}>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Eigene Tab einfügen</p>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={9} spellCheck={false}
            className="w-full rounded-lg border bg-transparent p-2 font-mono text-[12px] text-[color:var(--text-primary)]" style={{ borderColor: "var(--os-border-soft)" }} />
          {parsed.error ? <p className="mt-1 text-[12px] text-amber-600">{parsed.error}</p> : (
            <p className="mt-1 text-[11px] text-[color:var(--text-muted)]">Füge Tabs z. B. von Ultimate Guitar oder Songsterr ein (6 Zeilen, hohe e-Saite oben). Elyra zeigt dir jeden Griff auf dem Griffbrett.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Plan ─────────────────────────────────────────────────────────────────────

function Plan() {
  const [level, setLevel] = useState("Anfänger");
  const [goal, setGoal] = useState("Lagerfeuer-Lieder begleiten");
  const [minutes, setMinutes] = useState(20);
  const [result, setResult] = useState<{ markdown: string; source: string; model?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const create = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/os/learn", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "guitar_plan", level, goal, minutes }) });
      setResult(await res.json());
    } finally {
      setLoading(false);
    }
  };
  const field = { borderColor: "var(--os-border-soft)" };
  return (
    <div className="grid gap-4 md:grid-cols-[300px_1fr]">
      <div className="space-y-3 rounded-2xl border p-4" style={card}>
        <label className="block text-[12px] text-[color:var(--text-muted)]">Niveau
          <select value={level} onChange={(e) => setLevel(e.target.value)} className="mt-1 w-full rounded-lg border bg-transparent px-2 py-1.5 text-[13px] text-[color:var(--text-primary)]" style={field}>
            {["Anfänger", "Leicht fortgeschritten", "Fortgeschritten"].map((l) => <option key={l}>{l}</option>)}
          </select>
        </label>
        <label className="block text-[12px] text-[color:var(--text-muted)]">Ziel
          <input value={goal} onChange={(e) => setGoal(e.target.value)} className="mt-1 w-full rounded-lg border bg-transparent px-2 py-1.5 text-[13px] text-[color:var(--text-primary)]" style={field} />
        </label>
        <label className="block text-[12px] text-[color:var(--text-muted)]">Minuten pro Tag: {minutes}
          <input type="range" min={10} max={60} step={5} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="w-full" style={{ accentColor: ACCENT }} />
        </label>
        <button onClick={() => void create()} disabled={loading} className="inline-flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-60" style={{ background: ACCENT }}>
          <Sparkles size={15} className={loading ? "animate-pulse" : ""} /> {loading ? "Elly plant…" : "Übungsplan erstellen"}
        </button>
      </div>
      <div className="rounded-2xl border p-4" style={card}>
        {result ? (
          <>
            <div className="text-[13px] leading-relaxed text-[color:var(--text-primary)]"><ChatMarkdown text={result.markdown} /></div>
            <p className="mt-3 text-[11px] text-[color:var(--text-muted)]">{result.source === "model" ? `Erstellt von Elly (${result.model ?? "Gemini"})` : "Standardplan – KI gerade nicht erreichbar"}</p>
          </>
        ) : (
          <p className="text-[13px] text-[color:var(--text-muted)]">Sag Elly, wo du stehst und was du erreichen willst – sie baut dir einen 7-Tage-Plan mit Akkorden, Tempo und Schlagmustern. Die Akkorde findest du im Tab „Akkorde“, das Tempo im „Metronom“.</p>
        )}
      </div>
    </div>
  );
}

// ── Course (beginner path) ───────────────────────────────────────────────────

function useMicPitch(active: boolean) {
  const [freq, setFreq] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!active) { setFreq(null); return; }
    let stream: MediaStream | null = null;
    let raf = 0;
    let cancelled = false;
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        const ctx = audioCtx();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 4096;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const buf = new Float32Array(analyser.fftSize);
        const loop = () => {
          analyser.getFloatTimeDomainData(buf);
          const f = detectPitch(buf, ctx.sampleRate);
          setFreq(f > 0 ? f : null);
          raf = requestAnimationFrame(loop);
        };
        loop();
      } catch {
        setError("Kein Mikrofonzugriff – erlaube das Mikrofon im Browser.");
      }
    })();
    return () => { cancelled = true; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); };
  }, [active]);
  return { freq, error };
}

/** True if the played pitch matches the target note (same pitch class, ±45 cent; octave errors forgiven). */
function matches(freq: number, string: number, fret: number) {
  const target = fretFreq(string, fret);
  const cents = 1200 * Math.log2(freq / target);
  const mod = ((cents % 1200) + 1200) % 1200;
  return mod < 45 || mod > 1155;
}

function NoteExercise({ lesson, onDone }: { lesson: Lesson; onDone: () => void }) {
  const ex = lesson.exercise?.kind === "notes" ? lesson.exercise : null;
  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);
  const holdRef = useRef(0);
  const { freq, error } = useMicPitch(active && !!ex && step < (ex?.targets.length ?? 0));
  useEffect(() => { setStep(0); setActive(false); }, [lesson.id]);
  const target = ex?.targets[step];
  useEffect(() => {
    if (!target || !freq) { holdRef.current = 0; return; }
    if (matches(freq, target.string, target.fret)) {
      holdRef.current += 1;
      if (holdRef.current > 8) {
        holdRef.current = 0;
        const next = step + 1;
        setStep(next);
        if (ex && next >= ex.targets.length) { setActive(false); onDone(); }
      }
    } else holdRef.current = Math.max(0, holdRef.current - 1);
  }, [freq, target, ex, onDone, step]);
  if (!ex) return null;
  const done = step >= ex.targets.length;
  const heard = freq ? noteFromFreq(freq) : null;
  return (
    <div className="rounded-2xl border p-4" style={card}>
      <p className="text-[12px] font-semibold text-[color:var(--text-primary)]">🎤 Übung: {ex.intro}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {ex.targets.map((tg, i) => (
          <span key={i} className="rounded-full border px-2 py-0.5 text-[11px]"
            style={{ borderColor: i === step && active ? ACCENT : "var(--os-border-soft)", background: i < step ? "color-mix(in srgb,#16a34a 14%,transparent)" : "transparent", color: i < step ? "#16a34a" : "var(--text-secondary)" }}>
            {i < step ? "✓ " : ""}{i + 1}
          </span>
        ))}
      </div>
      {done ? (
        <p className="mt-3 text-[14px] font-semibold text-green-600">Super, alles getroffen! 🎉</p>
      ) : (
        <>
          <p className="mt-3 text-[18px] font-semibold text-[color:var(--text-primary)]">{target?.label}</p>
          <div className="mt-2"><Fretboard notes={target ? [target] : []} /></div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button onClick={() => setActive((a) => !a)} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-semibold text-white" style={{ background: active ? "#64748b" : ACCENT }}>
              {active ? <MicOff size={14} /> : <Mic size={14} />} {active ? "Pause" : step === 0 ? "Übung starten" : "Weiter"}
            </button>
            <button onClick={() => target && pluck(fretFreq(target.string, target.fret), 0, 1.8, 0.3)} className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[12px] text-[color:var(--text-primary)]" style={{ borderColor: "var(--os-border-soft)" }}>
              <Volume2 size={14} /> So klingt es
            </button>
            <button onClick={() => { const n = step + 1; setStep(n); if (n >= ex.targets.length) { setActive(false); onDone(); } }} className="text-[11px] text-[color:var(--text-muted)] underline">überspringen</button>
            {active ? <span className="text-[12px] text-[color:var(--text-muted)]">Ich höre: {heard ? `${heard.name}${heard.octave}` : "…"}</span> : null}
          </div>
          {error ? <p className="mt-2 text-[12px] text-red-500">{error}</p> : null}
        </>
      )}
    </div>
  );
}

function Quiz({ lesson, onDone }: { lesson: Lesson; onDone: () => void }) {
  const ex = lesson.exercise?.kind === "quiz" ? lesson.exercise : null;
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => { setPicked(null); }, [lesson.id]);
  if (!ex) return null;
  return (
    <div className="rounded-2xl border p-4" style={card}>
      <p className="text-[13px] font-semibold text-[color:var(--text-primary)]">❓ {ex.question}</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        {ex.options.map((o) => {
          const right = picked && o === ex.answer, wrong = picked === o && o !== ex.answer;
          return (
            <button key={o} onClick={() => { setPicked(o); if (o === ex.answer) onDone(); }} className="rounded-xl border px-3 py-2 text-[12px] text-[color:var(--text-primary)]"
              style={{ borderColor: right ? "#16a34a" : wrong ? "#dc2626" : "var(--os-border-soft)", background: right ? "color-mix(in srgb,#16a34a 12%,transparent)" : wrong ? "color-mix(in srgb,#dc2626 10%,transparent)" : "transparent" }}>
              {o}
            </button>
          );
        })}
      </div>
      {picked && picked !== ex.answer ? <p className="mt-2 text-[12px] text-[color:var(--text-muted)]">Nicht ganz – lies den Text oben nochmal und probier es erneut.</p> : null}
    </div>
  );
}

function Course({ onOpenTab }: { onOpenTab: (tab: Tab) => void }) {
  const [current, setCurrent] = useState(0);
  const [done, setDone] = useState<string[]>([]);
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem("elyra:guitar:course") ?? "{}") as { done?: string[]; current?: number };
      setDone(saved.done ?? []);
      setCurrent(Math.min(saved.current ?? 0, LESSONS.length - 1));
    } catch { /* ignore */ }
  }, []);
  const persist = (d: string[], c: number) => { try { window.localStorage.setItem("elyra:guitar:course", JSON.stringify({ done: d, current: c })); } catch { /* ignore */ } };
  const lesson = LESSONS[current]!;
  const complete = useCallback(() => {
    if (done.includes(lesson.id)) return;
    const next = [...done, lesson.id];
    setDone(next);
    persist(next, current);
  }, [done, lesson.id, current]);
  const goto = (i: number) => { setCurrent(i); persist(done, i); };
  const chord = lesson.visual?.kind === "chord" ? CHORDS.find((c) => c.name === (lesson.visual as { name: string }).name) : undefined;

  return (
    <div className="grid gap-4 lg:grid-cols-[250px_1fr]">
      <div className="rounded-2xl border p-2" style={card}>
        <div className="px-2 pb-2 pt-1">
          <p className="text-[12px] font-semibold text-[color:var(--text-primary)]">Gitarre von Null</p>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full" style={{ background: "var(--os-border-soft)" }}>
            <div className="h-full rounded-full" style={{ width: `${(done.length / LESSONS.length) * 100}%`, background: ACCENT }} />
          </div>
          <p className="mt-1 text-[11px] text-[color:var(--text-muted)]">{done.length} von {LESSONS.length} Lektionen</p>
        </div>
        {LESSONS.map((l, i) => (
          <button key={l.id} onClick={() => goto(i)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px]"
            style={{ background: i === current ? `color-mix(in srgb, ${ACCENT} 14%, transparent)` : "transparent", color: "var(--text-primary)" }}>
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
              style={{ background: done.includes(l.id) ? "#16a34a" : "var(--os-border-soft)", color: done.includes(l.id) ? "#fff" : "var(--text-secondary)" }}>
              {done.includes(l.id) ? <Check size={11} /> : i + 1}
            </span>
            <span className="truncate">{l.title}</span>
          </button>
        ))}
        <a href="https://www.justinguitar.com" target="_blank" rel="noreferrer" className="mt-2 flex items-center gap-1.5 px-2 pb-1 text-[11px] text-[color:var(--text-muted)] underline">
          <ExternalLink size={11} /> Ergänzend: kostenlose Videolektionen (JustinGuitar)
        </a>
      </div>

      <div className="space-y-3">
        <div className="rounded-2xl border p-5" style={card}>
          <p className="text-[11px] uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Lektion {current + 1} · ca. {lesson.minutes} Min.</p>
          <h2 className="mt-1 text-[18px] font-semibold text-[color:var(--text-primary)]">{lesson.title}</h2>
          <div className="mt-3 text-[13.5px] leading-relaxed text-[color:var(--text-primary)]"><ChatMarkdown text={lesson.text} /></div>
          {lesson.visual?.kind === "fretboard" ? <div className="mt-3"><Fretboard notes={lesson.visual.notes} /></div> : null}
          {chord ? (
            <div className="mt-3 flex items-center gap-4">
              <ChordDiagram chord={chord} size={1.4} />
              <button onClick={() => playNotes(chord.frets.map((fret, string) => ({ string, fret })).filter((n) => n.fret >= 0))} className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[12px] text-[color:var(--text-primary)]" style={{ borderColor: "var(--os-border-soft)" }}>
                <Volume2 size={14} /> {chord.name} anhören
              </button>
            </div>
          ) : null}
          {lesson.visual?.kind === "tab" ? <pre className="mt-3 overflow-x-auto rounded-xl p-3 font-mono text-[13px] text-[color:var(--text-primary)]" style={{ background: "var(--bg-elevated)" }}>{lesson.visual.tab}</pre> : null}
          {lesson.tip ? <p className="mt-3 rounded-xl px-3 py-2 text-[12px] text-[color:var(--text-secondary)]" style={{ background: `color-mix(in srgb, ${ACCENT} 10%, transparent)` }}>💡 {lesson.tip}</p> : null}
        </div>

        {lesson.exercise?.kind === "notes" ? <NoteExercise lesson={lesson} onDone={complete} /> : null}
        {lesson.exercise?.kind === "quiz" ? <Quiz lesson={lesson} onDone={complete} /> : null}

        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => goto(Math.max(0, current - 1))} disabled={current === 0} className="inline-flex items-center gap-1 rounded-xl border px-3 py-2 text-[12px] text-[color:var(--text-primary)] disabled:opacity-40" style={{ borderColor: "var(--os-border-soft)" }}>
            <ChevronLeft size={14} /> Zurück
          </button>
          {lesson.action ? (
            <button onClick={() => onOpenTab(lesson.action!.tab)} className="rounded-xl border px-3 py-2 text-[12px] text-[color:var(--text-primary)]" style={{ borderColor: ACCENT }}>
              {lesson.action.label} →
            </button>
          ) : null}
          {!lesson.exercise ? (
            <button onClick={complete} className="rounded-xl border px-3 py-2 text-[12px] text-[color:var(--text-primary)]" style={{ borderColor: "var(--os-border-soft)" }}>
              {done.includes(lesson.id) ? "✓ Erledigt" : "Als erledigt markieren"}
            </button>
          ) : null}
          <button onClick={() => goto(Math.min(LESSONS.length - 1, current + 1))} disabled={current === LESSONS.length - 1} className="ml-auto inline-flex items-center gap-1 rounded-xl px-4 py-2 text-[12px] font-semibold text-white disabled:opacity-40" style={{ background: ACCENT }}>
            Nächste Lektion <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Window ───────────────────────────────────────────────────────────────────

export default function GuitarWindow() {
  const [tab, setTab] = useState<Tab>("course");
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "course", label: "Kurs" },
    { id: "tuner", label: "Stimmgerät" },
    { id: "chords", label: "Akkorde" },
    { id: "metronome", label: "Metronom" },
    { id: "tabs", label: "Tabs" },
    { id: "plan", label: "Übungsplan" },
  ];
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b px-5 py-3" style={{ borderColor: "var(--os-border-soft)" }}>
        <Guitar size={18} style={{ color: ACCENT }} />
        <h1 className="text-[15px] font-semibold text-[color:var(--text-primary)]">Gitarre</h1>
        <div className="ml-auto flex flex-wrap gap-1">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} className="rounded-lg px-3 py-1.5 text-[12px] font-medium"
              style={{ background: tab === t.id ? `color-mix(in srgb, ${ACCENT} 16%, transparent)` : "transparent", color: tab === t.id ? ACCENT : "var(--text-secondary)" }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-auto p-5">
        {tab === "course" && <Course onOpenTab={setTab} />}
        {tab === "tuner" && <Tuner />}
        {tab === "chords" && <Chords />}
        {tab === "metronome" && <Metronome />}
        {tab === "tabs" && <Tabs />}
        {tab === "plan" && <Plan />}
      </div>
    </div>
  );
}
