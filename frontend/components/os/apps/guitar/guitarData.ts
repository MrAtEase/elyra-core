/** Guitar data: standard tuning, chord shapes, public-domain practice tabs. */

/** Open string frequencies, low E → high e (index 0..5). */
export const OPEN_STRINGS = [
  { name: "E", octave: 2, freq: 82.41 },
  { name: "A", octave: 2, freq: 110.0 },
  { name: "D", octave: 3, freq: 146.83 },
  { name: "G", octave: 3, freq: 196.0 },
  { name: "H", octave: 3, freq: 246.94 },
  { name: "e", octave: 4, freq: 329.63 },
] as const;

/** German note names (H instead of B). */
export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "H"];

export type Chord = {
  name: string;
  /** frets low E → high e; -1 = muted, 0 = open */
  frets: [number, number, number, number, number, number];
  /** finger numbers low E → high e (0 = none) */
  fingers?: [number, number, number, number, number, number];
  barre?: { fret: number; from: number; to: number };
  group: "Dur" | "Moll" | "Sept" | "Sus/Add" | "Barré";
};

export const CHORDS: Chord[] = [
  { name: "C", frets: [-1, 3, 2, 0, 1, 0], fingers: [0, 3, 2, 0, 1, 0], group: "Dur" },
  { name: "D", frets: [-1, -1, 0, 2, 3, 2], fingers: [0, 0, 0, 1, 3, 2], group: "Dur" },
  { name: "E", frets: [0, 2, 2, 1, 0, 0], fingers: [0, 2, 3, 1, 0, 0], group: "Dur" },
  { name: "G", frets: [3, 2, 0, 0, 0, 3], fingers: [2, 1, 0, 0, 0, 3], group: "Dur" },
  { name: "A", frets: [-1, 0, 2, 2, 2, 0], fingers: [0, 0, 1, 2, 3, 0], group: "Dur" },
  { name: "Am", frets: [-1, 0, 2, 2, 1, 0], fingers: [0, 0, 2, 3, 1, 0], group: "Moll" },
  { name: "Em", frets: [0, 2, 2, 0, 0, 0], fingers: [0, 2, 3, 0, 0, 0], group: "Moll" },
  { name: "Dm", frets: [-1, -1, 0, 2, 3, 1], fingers: [0, 0, 0, 2, 3, 1], group: "Moll" },
  { name: "E7", frets: [0, 2, 0, 1, 0, 0], fingers: [0, 2, 0, 1, 0, 0], group: "Sept" },
  { name: "A7", frets: [-1, 0, 2, 0, 2, 0], fingers: [0, 0, 2, 0, 3, 0], group: "Sept" },
  { name: "D7", frets: [-1, -1, 0, 2, 1, 2], fingers: [0, 0, 0, 2, 1, 3], group: "Sept" },
  { name: "G7", frets: [3, 2, 0, 0, 0, 1], fingers: [3, 2, 0, 0, 0, 1], group: "Sept" },
  { name: "C7", frets: [-1, 3, 2, 3, 1, 0], fingers: [0, 3, 2, 4, 1, 0], group: "Sept" },
  { name: "H7", frets: [-1, 2, 1, 2, 0, 2], fingers: [0, 2, 1, 3, 0, 4], group: "Sept" },
  { name: "Am7", frets: [-1, 0, 2, 0, 1, 0], fingers: [0, 0, 2, 0, 1, 0], group: "Sept" },
  { name: "Em7", frets: [0, 2, 2, 0, 3, 0], fingers: [0, 1, 2, 0, 4, 0], group: "Sept" },
  { name: "Dmaj7", frets: [-1, -1, 0, 2, 2, 2], fingers: [0, 0, 0, 1, 2, 3], group: "Sept" },
  { name: "Fmaj7", frets: [-1, -1, 3, 2, 1, 0], fingers: [0, 0, 3, 2, 1, 0], group: "Sept" },
  { name: "Asus2", frets: [-1, 0, 2, 2, 0, 0], fingers: [0, 0, 1, 2, 0, 0], group: "Sus/Add" },
  { name: "Asus4", frets: [-1, 0, 2, 2, 3, 0], fingers: [0, 0, 1, 2, 3, 0], group: "Sus/Add" },
  { name: "Dsus2", frets: [-1, -1, 0, 2, 3, 0], fingers: [0, 0, 0, 1, 3, 0], group: "Sus/Add" },
  { name: "Dsus4", frets: [-1, -1, 0, 2, 3, 3], fingers: [0, 0, 0, 1, 2, 3], group: "Sus/Add" },
  { name: "Cadd9", frets: [-1, 3, 2, 0, 3, 3], fingers: [0, 2, 1, 0, 3, 4], group: "Sus/Add" },
  { name: "F", frets: [1, 3, 3, 2, 1, 1], fingers: [1, 3, 4, 2, 1, 1], barre: { fret: 1, from: 0, to: 5 }, group: "Barré" },
  { name: "Hm", frets: [-1, 2, 4, 4, 3, 2], fingers: [0, 1, 3, 4, 2, 1], barre: { fret: 2, from: 1, to: 5 }, group: "Barré" },
  { name: "Fm", frets: [1, 3, 3, 1, 1, 1], fingers: [1, 3, 4, 1, 1, 1], barre: { fret: 1, from: 0, to: 5 }, group: "Barré" },
];

/** A note in a tab token: string index low E (0) → high e (5) and fret. */
export type TabNote = { string: number; fret: number };

/** Builds an ASCII tab (high e on top) from a sequence of columns. */
export function buildTab(columns: TabNote[][], spacing = 2): string {
  const width = columns.length * (spacing + 1) + spacing;
  const rows = Array.from({ length: 6 }, () => Array.from({ length: width }, () => "-"));
  columns.forEach((col, i) => {
    const pos = spacing + i * (spacing + 1);
    for (const note of col) {
      const digits = String(note.fret);
      for (let k = 0; k < digits.length; k++) rows[note.string]![pos + k] = digits[k]!;
    }
  });
  const labels = ["E", "A", "D", "G", "B", "e"];
  return [5, 4, 3, 2, 1, 0].map((s) => `${labels[s]}|${rows[s]!.join("")}|`).join("\n");
}

const e = (fret: number): TabNote => ({ string: 5, fret });
const B = (fret: number): TabNote => ({ string: 4, fret });
const chord = (frets: number[]): TabNote[] =>
  frets.map((fret, string) => ({ string, fret })).filter((n) => n.fret >= 0);

export const EXAMPLE_TABS: Array<{ title: string; note: string; tab: string }> = [
  {
    title: "Ode an die Freude (Beethoven)",
    note: "Melodie auf e- und H-Saite – gemeinfrei",
    tab: buildTab([
      [e(0)], [e(0)], [e(1)], [e(3)], [e(3)], [e(1)], [e(0)], [B(3)],
      [B(1)], [B(1)], [B(3)], [e(0)], [e(0)], [B(3)], [B(3)],
    ]),
  },
  {
    title: "Alle meine Entchen",
    note: "Volkslied – ideal für die ersten Töne",
    tab: buildTab([
      [B(1)], [B(3)], [e(0)], [e(1)], [e(3)], [e(3)],
      [e(5)], [e(5)], [e(5)], [e(5)], [e(3)],
      [e(5)], [e(5)], [e(5)], [e(5)], [e(3)],
      [e(1)], [e(1)], [e(1)], [e(1)], [e(0)], [e(0)],
      [B(3)], [B(3)], [B(3)], [B(3)], [B(1)],
    ]),
  },
  {
    title: "Akkordfolge G – Em – C – D",
    note: "Jede Spalte ein Akkord – je 4 Schläge halten",
    tab: buildTab([
      chord([3, 2, 0, 0, 0, 3]),
      chord([0, 2, 2, 0, 0, 0]),
      chord([-1, 3, 2, 0, 1, 0]),
      chord([-1, -1, 0, 2, 3, 2]),
    ], 3),
  },
];

/** A parsed step of a tab: notes plus where they are in the text (for highlighting). */
export type TabStep = { notes: TabNote[]; marks: Array<{ line: number; col: number; len: number }> };

const LINE_RE = /^\s*([eEbBgGdDaAhH])\s*[|:]/;

/** Parses ASCII guitar tabs (blocks of 6 lines, high e on top). */
export function parseTab(text: string): { steps: TabStep[]; lines: string[]; error?: string } {
  const lines = text.replace(/\r/g, "").split("\n");
  const steps: TabStep[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!LINE_RE.test(lines[i] ?? "")) { i++; continue; }
    const block: number[] = [];
    while (block.length < 6 && i < lines.length && LINE_RE.test(lines[i] ?? "")) { block.push(i); i++; }
    if (block.length < 6) continue;
    const startCol = Math.max(...block.map((li) => (lines[li] ?? "").search(/[|:]/) + 1));
    const maxLen = Math.max(...block.map((li) => (lines[li] ?? "").length));
    const byCol = new Map<number, TabStep>();
    block.forEach((lineIndex, rowInBlock) => {
      const line = lines[lineIndex] ?? "";
      const stringIndex = 5 - rowInBlock;
      for (let c = startCol; c < maxLen; c++) {
        const ch = line[c] ?? "";
        if (!/\d/.test(ch) || /\d/.test(line[c - 1] ?? "")) continue;
        let len = 1;
        if (/\d/.test(line[c + 1] ?? "") && Number(ch + line[c + 1]) <= 24) len = 2;
        const fret = Number(line.slice(c, c + len));
        const step = byCol.get(c) ?? { notes: [], marks: [] };
        step.notes.push({ string: stringIndex, fret });
        step.marks.push({ line: lineIndex, col: c, len });
        byCol.set(c, step);
      }
    });
    [...byCol.entries()].sort((a, b) => a[0] - b[0]).forEach(([, step]) => steps.push(step));
  }
  if (!steps.length) return { steps, lines, error: "Keine Tab gefunden. Erwartet werden 6 Zeilen wie „e|--0--|“ bis „E|--3--|“." };
  return { steps, lines };
}

export function noteFromFreq(freq: number): { name: string; octave: number; cents: number; target: number } {
  const n = 12 * Math.log2(freq / 440) + 69;
  const rounded = Math.round(n);
  const target = 440 * Math.pow(2, (rounded - 69) / 12);
  return {
    name: NOTE_NAMES[((rounded % 12) + 12) % 12]!,
    octave: Math.floor(rounded / 12) - 1,
    cents: Math.round(1200 * Math.log2(freq / target)),
    target,
  };
}

/** Autocorrelation pitch detection (returns -1 when silent / unclear). */
export function detectPitch(buf: Float32Array, sampleRate: number): number {
  let size = buf.length;
  let rms = 0;
  for (let i = 0; i < size; i++) rms += buf[i]! * buf[i]!;
  rms = Math.sqrt(rms / size);
  if (rms < 0.01) return -1;
  let r1 = 0, r2 = size - 1;
  const thres = 0.2;
  for (let i = 0; i < size / 2; i++) if (Math.abs(buf[i]!) < thres) { r1 = i; break; }
  for (let i = 1; i < size / 2; i++) if (Math.abs(buf[size - i]!) < thres) { r2 = size - i; break; }
  const b = buf.slice(r1, r2);
  size = b.length;
  const c = new Array<number>(size).fill(0);
  for (let i = 0; i < size; i++) for (let j = 0; j < size - i; j++) c[i] = c[i]! + b[j]! * b[j + i]!;
  let d = 0;
  while (d < size - 1 && c[d]! > c[d + 1]!) d++;
  let maxval = -1, maxpos = -1;
  for (let i = d; i < size; i++) if (c[i]! > maxval) { maxval = c[i]!; maxpos = i; }
  if (maxpos <= 0) return -1;
  let T0 = maxpos;
  const x1 = c[T0 - 1] ?? 0, x2 = c[T0]!, x3 = c[T0 + 1] ?? 0;
  const a = (x1 + x3 - 2 * x2) / 2, bb = (x3 - x1) / 2;
  if (a) T0 = T0 - bb / (2 * a);
  const f = sampleRate / T0;
  return f > 60 && f < 1400 ? f : -1;
}
