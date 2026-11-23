"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Pause, Play, RotateCcw, Sparkles, Spade, Timer } from "lucide-react";
import ChatMarkdown from "@/components/agent/ChatMarkdown";
import { CATEGORIES, LEVEL_LABEL, MOVES, TRICKS, type Diagram, type Move, type Trick } from "./magicData";

/**
 * Hobby › Kartenmagie — techniques, tricks, practice log and routine coach.
 * Techniques are explained in our own words; book references show where they are taught in depth.
 */

type Tab = "moves" | "tricks" | "practice" | "coach";
type Status = "neu" | "lernen" | "üben" | "sitzt" | "bühnenreif";
const STATUSES: Status[] = ["neu", "lernen", "üben", "sitzt", "bühnenreif"];
const STATUS_COLOR: Record<Status, string> = { neu: "#94a3b8", lernen: "#0ea5e9", üben: "#f59e0b", sitzt: "#16a34a", bühnenreif: "#a855f7" };

const ACCENT = "#a855f7";
const card = { borderColor: "var(--os-border-soft)", background: "var(--bg-surface)" } as const;
const STORE = "elyra:magic:v1";

type Store = { status: Record<string, Status>; minutes: Record<string, number>; log: Array<{ id: string; at: number; min: number }> };
const emptyStore: Store = { status: {}, minutes: {}, log: [] };

function loadStore(): Store {
  try { return { ...emptyStore, ...(JSON.parse(window.localStorage.getItem(STORE) ?? "{}") as Partial<Store>) }; } catch { return emptyStore; }
}

// ── Illustrations ────────────────────────────────────────────────────────────

function CardFace({ x, y, w, h, hi, face, rotate = 0, cx, cy }: { x: number; y: number; w: number; h: number; hi?: boolean | undefined; face?: boolean | undefined; rotate?: number; cx?: number; cy?: number }) {
  return (
    <g transform={rotate ? `rotate(${rotate} ${cx ?? x} ${cy ?? y})` : undefined}>
      <rect x={x} y={y} width={w} height={h} rx={4} fill={face ? "#fff" : hi ? ACCENT : "#1e3a8a"} stroke={hi ? ACCENT : "#0f172a"} strokeWidth={hi ? 2 : 1} />
      {!face ? <rect x={x + 3} y={y + 3} width={w - 6} height={h - 6} rx={2} fill="none" stroke="rgba(255,255,255,0.35)" /> : null}
    </g>
  );
}

function DiagramView({ d }: { d: Diagram }) {
  if (d.kind === "stack") {
    const rowH = 16, w = 170, left = 40, top = 26;
    const extra = d.breakAfter ? 6 : 0;
    const h = top + d.cards.length * rowH + extra + 30;
    return (
      <figure className="rounded-xl p-3" style={{ background: "var(--bg-elevated)" }}>
        <svg width="100%" viewBox={`0 0 460 ${h}`} style={{ maxWidth: 460 }}>
          <text x={left} y={16} fontSize={11} fill="var(--text-muted)">{d.title} · oben = Oberseite des Decks</text>
          {d.cards.map((c, i) => {
            const y = top + i * rowH + (d.breakAfter && i >= d.breakAfter ? extra : 0);
            const dx = c.jog === "in" ? -16 : c.jog === "out" ? 16 : 0;
            return (
              <g key={i}>
                <rect x={left + dx} y={y} width={w} height={rowH - 4} rx={2} fill={c.face ? "#fff" : c.hi ? ACCENT : "#1e3a8a"} stroke={c.hi ? ACCENT : "#0f172a"} />
                {c.label ? <text x={left + w + 24} y={y + 10} fontSize={11.5} fill={c.hi ? ACCENT : "var(--text-secondary)"} fontWeight={c.hi ? 700 : 400}>{c.label}</text> : null}
              </g>
            );
          })}
          {d.breakAfter ? (
            <g>
              <line x1={left + w - 10} x2={left + w + 14} y1={top + d.breakAfter * rowH + 1} y2={top + d.breakAfter * rowH + 1} stroke="#f59e0b" strokeWidth={2} />
              <text x={left + w - 2} y={top + d.breakAfter * rowH + 16} fontSize={10} fill="#f59e0b">Break</text>
            </g>
          ) : null}
          <text x={left} y={h - 6} fontSize={10} fill="var(--text-muted)">← Innenseite (zu dir) · Außenseite (zum Publikum) →</text>
        </svg>
        {d.caption ? <figcaption className="mt-1 text-[11px] text-[color:var(--text-muted)]">{d.caption}</figcaption> : null}
      </figure>
    );
  }
  if (d.kind === "grip") {
    const fingers: Record<string, Array<{ x: number; y: number; label: string }>> = {
      mechanics: [{ x: 70, y: 70, label: "Daumen" }, { x: 110, y: 18, label: "Zeigefinger" }, { x: 168, y: 70, label: "Mittelf." }, { x: 168, y: 105, label: "Ringf." }, { x: 168, y: 140, label: "kl. Finger" }],
      biddle: [{ x: 150, y: 182, label: "Daumen" }, { x: 105, y: 18, label: "Mittelf." }, { x: 135, y: 18, label: "Ringf." }, { x: 115, y: 95, label: "Zeigefinger (oben)" }],
      break: [{ x: 168, y: 165, label: "kl. Finger hält Break" }, { x: 70, y: 70, label: "Daumen" }],
      dealing: [{ x: 120, y: 80, label: "Daumen schiebt" }, { x: 110, y: 18, label: "Zeigefinger" }, { x: 168, y: 110, label: "Finger rechts" }],
    };
    return (
      <figure className="rounded-xl p-3" style={{ background: "var(--bg-elevated)" }}>
        <svg width="100%" viewBox="0 0 300 200" style={{ maxWidth: 300 }}>
          <CardFace x={75} y={25} w={95} h={150} />
          {d.grip === "dealing" ? <CardFace x={95} y={25} w={95} h={150} /> : null}
          {fingers[d.grip]!.map((f, i) => (
            <g key={i}>
              <circle cx={f.x} cy={f.y} r={9} fill="#f2c4a0" stroke="#b45309" />
              <text x={f.x + (f.x > 150 ? 14 : -14)} y={f.y + 4} fontSize={10} fill="var(--text-secondary)" textAnchor={f.x > 150 ? "start" : "end"}>{f.label}</text>
            </g>
          ))}
          <text x={122} y={196} fontSize={9} fill="var(--text-muted)" textAnchor="middle">↓ zu dir</text>
        </svg>
        {d.caption ? <figcaption className="mt-1 text-[11px] text-[color:var(--text-muted)]">{d.caption}</figcaption> : null}
      </figure>
    );
  }
  if (d.kind === "spread") {
    const cw = 34, ch = 52;
    return (
      <figure className="rounded-xl p-3" style={{ background: "var(--bg-elevated)" }}>
        <svg width="100%" viewBox={d.fan ? "0 0 300 150" : "0 0 460 80"} style={{ maxWidth: d.fan ? 300 : 460 }}>
          {Array.from({ length: d.count }, (_, i) => d.fan ? (
            <CardFace key={i} x={133} y={60} w={cw} h={ch + 20} hi={i === d.hi} rotate={-70 + (140 / (d.count - 1)) * i} cx={150} cy={140} />
          ) : (
            <CardFace key={i} x={10 + i * 15} y={12} w={cw} h={ch} hi={i === d.hi} />
          ))}
        </svg>
        {d.caption ? <figcaption className="mt-1 text-[11px] text-[color:var(--text-muted)]">{d.caption}</figcaption> : null}
      </figure>
    );
  }
  return (
    <figure className="rounded-xl p-3" style={{ background: "var(--bg-elevated)" }}>
      <svg width="100%" viewBox={`0 0 ${d.piles.length * 110} 120`} style={{ maxWidth: d.piles.length * 110 }}>
        {d.piles.map((p, i) => (
          <g key={i}>
            {[4, 2, 0].map((o) => <CardFace key={o} x={20 + i * 110 + o} y={10 + o} w={60} h={80} hi={p.hi && o === 0} />)}
            <text x={50 + i * 110} y={106} fontSize={11} textAnchor="middle" fill={p.hi ? ACCENT : "var(--text-primary)"} fontWeight={700}>{p.label}</text>
            {p.note ? <text x={50 + i * 110} y={118} fontSize={9} textAnchor="middle" fill="var(--text-muted)">{p.note}</text> : null}
          </g>
        ))}
      </svg>
      {d.caption ? <figcaption className="mt-1 text-[11px] text-[color:var(--text-muted)]">{d.caption}</figcaption> : null}
    </figure>
  );
}

// ── Practice timer ───────────────────────────────────────────────────────────

function PracticeTimer({ onLog }: { onLog: (min: number) => void }) {
  const [running, setRunning] = useState(false);
  const [sec, setSec] = useState(0);
  const ref = useRef<number | null>(null);
  useEffect(() => {
    if (!running) return;
    ref.current = window.setInterval(() => setSec((s) => s + 1), 1000);
    return () => { if (ref.current) window.clearInterval(ref.current); };
  }, [running]);
  const mm = String(Math.floor(sec / 60)).padStart(2, "0"), ss = String(sec % 60).padStart(2, "0");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-1 font-mono text-[15px] tabular-nums text-[color:var(--text-primary)]"><Timer size={14} /> {mm}:{ss}</span>
      <button onClick={() => setRunning((r) => !r)} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[12px] font-semibold text-white" style={{ background: running ? "#64748b" : ACCENT }}>
        {running ? <Pause size={13} /> : <Play size={13} />} {running ? "Pause" : "Üben starten"}
      </button>
      {sec >= 30 ? (
        <button onClick={() => { onLog(Math.max(1, Math.round(sec / 60))); setSec(0); setRunning(false); }} className="rounded-lg border px-2.5 py-1 text-[12px] text-[color:var(--text-primary)]" style={{ borderColor: "var(--os-border-soft)" }}>
          Eintragen
        </button>
      ) : null}
      {sec > 0 && !running ? <button onClick={() => setSec(0)} className="text-[color:var(--text-muted)]"><RotateCcw size={13} /></button> : null}
    </div>
  );
}

function StatusPicker({ value, onChange }: { value: Status; onChange: (s: Status) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {STATUSES.map((s) => (
        <button key={s} onClick={() => onChange(s)} className="rounded-full border px-2 py-0.5 text-[11px] capitalize"
          style={{ borderColor: value === s ? STATUS_COLOR[s] : "var(--os-border-soft)", background: value === s ? `color-mix(in srgb, ${STATUS_COLOR[s]} 16%, transparent)` : "transparent", color: value === s ? STATUS_COLOR[s] : "var(--text-secondary)" }}>
          {s}
        </button>
      ))}
    </div>
  );
}

// ── Detail views ─────────────────────────────────────────────────────────────

function MoveDetail({ move, store, setStatus, logMinutes }: { move: Move; store: Store; setStatus: (id: string, s: Status) => void; logMinutes: (id: string, m: number) => void }) {
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border p-5" style={card}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-[11px] uppercase tracking-[0.12em] text-[color:var(--text-muted)]">{move.category} · {LEVEL_LABEL[move.level]}</p>
            <h2 className="text-[19px] font-semibold text-[color:var(--text-primary)]">{move.name}{move.en ? <span className="ml-2 text-[13px] font-normal text-[color:var(--text-muted)]">({move.en})</span> : null}</h2>
          </div>
          <div className="flex gap-1">{"★★★★★".slice(0, move.level).split("").map((s, i) => <span key={i} style={{ color: ACCENT }}>{s}</span>)}</div>
        </div>
        <p className="mt-2 text-[13.5px] text-[color:var(--text-primary)]">{move.purpose}</p>
        <div className="mt-4 grid gap-4 md:grid-cols-[1fr_auto]">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Schritt für Schritt</p>
            <ol className="mt-1.5 space-y-1.5">
              {move.steps.map((s, i) => (
                <li key={i} className="flex gap-2 text-[13px] text-[color:var(--text-primary)]">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: ACCENT }}>{i + 1}</span>{s}
                </li>
              ))}
            </ol>
          </div>
          <div className="space-y-2">{move.diagrams?.map((d, i) => <DiagramView key={i} d={d} />)}</div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-xl px-3 py-2" style={{ background: "color-mix(in srgb,#dc2626 8%,transparent)" }}>
            <p className="text-[11px] font-semibold text-red-500">Typische Fehler</p>
            <ul className="mt-1 list-disc pl-4 text-[12px] text-[color:var(--text-secondary)]">{move.mistakes.map((m, i) => <li key={i}>{m}</li>)}</ul>
          </div>
          <div className="rounded-xl px-3 py-2" style={{ background: `color-mix(in srgb, ${ACCENT} 9%, transparent)` }}>
            <p className="text-[11px] font-semibold" style={{ color: ACCENT }}>Übungsdrill</p>
            <p className="mt-1 text-[12px] text-[color:var(--text-secondary)]">{move.drill}</p>
          </div>
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-[color:var(--text-muted)]"><BookOpen size={12} /> Ausführlich in: {move.books.join(" · ")}</p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3" style={card}>
        <div>
          <p className="mb-1 text-[11px] text-[color:var(--text-muted)]">Mein Stand · {store.minutes[move.id] ?? 0} Min. geübt</p>
          <StatusPicker value={store.status[move.id] ?? "neu"} onChange={(s) => setStatus(move.id, s)} />
        </div>
        <PracticeTimer onLog={(m) => logMinutes(move.id, m)} />
      </div>
    </div>
  );
}

function TrickDetail({ trick, store, setStatus, openMove }: { trick: Trick; store: Store; setStatus: (id: string, s: Status) => void; openMove: (id: string) => void }) {
  return (
    <div className="rounded-2xl border p-5" style={card}>
      <p className="text-[11px] uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Trick · {LEVEL_LABEL[trick.level]}</p>
      <h2 className="text-[19px] font-semibold text-[color:var(--text-primary)]">{trick.name}</h2>
      <p className="mt-2 rounded-xl px-3 py-2 text-[13.5px] italic text-[color:var(--text-primary)]" style={{ background: "var(--bg-elevated)" }}>✨ {trick.effect}</p>
      {trick.uses.length ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[12px] text-[color:var(--text-muted)]">
          Benötigt:
          {trick.uses.map((id) => {
            const m = MOVES.find((x) => x.id === id);
            return m ? <button key={id} onClick={() => openMove(id)} className="rounded-full border px-2 py-0.5 text-[11px]" style={{ borderColor: ACCENT, color: ACCENT }}>{m.name}</button> : null;
          })}
        </div>
      ) : <p className="mt-3 text-[12px] text-[color:var(--text-muted)]">Benötigt keine Fingerfertigkeit (Selbstläufer).</p>}
      <p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Vorbereitung</p>
      <p className="text-[13px] text-[color:var(--text-primary)]">{trick.setup}</p>
      <div className="mt-3 grid gap-4 md:grid-cols-[1fr_auto]">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Ablauf</p>
          <ol className="mt-1.5 space-y-1.5">
            {trick.method.map((s, i) => (
              <li key={i} className="flex gap-2 text-[13px] text-[color:var(--text-primary)]">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: ACCENT }}>{i + 1}</span>{s}
              </li>
            ))}
          </ol>
        </div>
        <div>{trick.diagrams?.map((d, i) => <DiagramView key={i} d={d} />)}</div>
      </div>
      <div className="mt-3 rounded-xl px-3 py-2" style={{ background: `color-mix(in srgb, ${ACCENT} 9%, transparent)` }}>
        <p className="text-[11px] font-semibold" style={{ color: ACCENT }}>Präsentationsidee</p>
        <p className="mt-1 text-[12px] text-[color:var(--text-secondary)]">{trick.presentation}</p>
      </div>
      <div className="mt-3"><StatusPicker value={store.status[trick.id] ?? "neu"} onChange={(s) => setStatus(trick.id, s)} /></div>
    </div>
  );
}

// ── Window ───────────────────────────────────────────────────────────────────

export default function MagicWindow() {
  const [tab, setTab] = useState<Tab>("moves");
  const [store, setStore] = useState<Store>(emptyStore);
  const [moveId, setMoveId] = useState(MOVES[0]!.id);
  const [trickId, setTrickId] = useState(TRICKS[0]!.id);
  const [cat, setCat] = useState<string>("Alle");
  const [coach, setCoach] = useState<{ markdown: string; source: string; model?: string } | null>(null);
  const [coachLoading, setCoachLoading] = useState(false);
  const [minutes, setMinutes] = useState(5);
  const [audience, setAudience] = useState("kleine Runde am Tisch");

  useEffect(() => { setStore(loadStore()); }, []);
  const save = (next: Store) => { setStore(next); try { window.localStorage.setItem(STORE, JSON.stringify(next)); } catch { /* ignore */ } };
  const setStatus = (id: string, s: Status) => save({ ...store, status: { ...store.status, [id]: s } });
  const logMinutes = (id: string, m: number) => save({ ...store, minutes: { ...store.minutes, [id]: (store.minutes[id] ?? 0) + m }, log: [...store.log, { id, at: Date.now(), min: m }].slice(-200) });

  const move = MOVES.find((m) => m.id === moveId)!;
  const trick = TRICKS.find((t) => t.id === trickId)!;
  const moves = cat === "Alle" ? MOVES : MOVES.filter((m) => m.category === cat);

  const known = useMemo(() => [...MOVES, ...TRICKS].filter((x) => ["sitzt", "bühnenreif"].includes(store.status[x.id] ?? "")).map((x) => x.name), [store]);
  const learning = useMemo(() => MOVES.filter((m) => ["lernen", "üben"].includes(store.status[m.id] ?? "")), [store]);
  const todays = useMemo(() => {
    const pool = learning.length ? learning : MOVES.filter((m) => m.level <= 2);
    const day = Math.floor(Date.now() / 86_400_000);
    return [0, 1, 2].map((k) => pool[(day * 7 + k * 5) % pool.length]!).filter((m, i, a) => a.indexOf(m) === i);
  }, [learning]);
  const totalMin = Object.values(store.minutes).reduce((a, b) => a + b, 0);
  const weekMin = store.log.filter((l) => Date.now() - l.at < 7 * 86_400_000).reduce((a, l) => a + l.min, 0);

  const askCoach = async () => {
    setCoachLoading(true);
    try {
      const res = await fetch("/api/os/learn", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "magic_routine", known: known.join(", "), minutes, audience }) });
      setCoach(await res.json());
    } finally { setCoachLoading(false); }
  };

  const listBtn = (active: boolean) => ({ background: active ? `color-mix(in srgb, ${ACCENT} 14%, transparent)` : "transparent", color: "var(--text-primary)" });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b px-5 py-3" style={{ borderColor: "var(--os-border-soft)" }}>
        <Spade size={18} style={{ color: ACCENT }} />
        <h1 className="text-[15px] font-semibold text-[color:var(--text-primary)]">Kartenmagie</h1>
        <span className="text-[11px] text-[color:var(--text-muted)]">{MOVES.length} Techniken · {TRICKS.length} Tricks · {totalMin} Min. geübt</span>
        <div className="ml-auto flex gap-1">
          {([["moves", "Techniken"], ["tricks", "Tricks"], ["practice", "Training"], ["coach", "Routine-Coach"]] as const).map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} className="rounded-lg px-3 py-1.5 text-[12px] font-medium"
              style={{ background: tab === id ? `color-mix(in srgb, ${ACCENT} 16%, transparent)` : "transparent", color: tab === id ? ACCENT : "var(--text-secondary)" }}>{label}</button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-5">
        {tab === "moves" && (
          <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
            <div className="rounded-2xl border p-2" style={card}>
              <select value={cat} onChange={(e) => setCat(e.target.value)} className="mb-2 w-full rounded-lg border bg-transparent px-2 py-1.5 text-[12px] text-[color:var(--text-primary)]" style={{ borderColor: "var(--os-border-soft)" }}>
                {["Alle", ...CATEGORIES].map((c) => <option key={c}>{c}</option>)}
              </select>
              {moves.map((m) => (
                <button key={m.id} onClick={() => setMoveId(m.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px]" style={listBtn(m.id === moveId)}>
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: STATUS_COLOR[store.status[m.id] ?? "neu"] }} />
                  <span className="flex-1 truncate">{m.name}</span>
                  <span className="text-[10px]" style={{ color: ACCENT }}>{"★".repeat(m.level)}</span>
                </button>
              ))}
            </div>
            <MoveDetail move={move} store={store} setStatus={setStatus} logMinutes={logMinutes} />
          </div>
        )}

        {tab === "tricks" && (
          <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
            <div className="rounded-2xl border p-2" style={card}>
              {TRICKS.map((t) => (
                <button key={t.id} onClick={() => setTrickId(t.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px]" style={listBtn(t.id === trickId)}>
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: STATUS_COLOR[store.status[t.id] ?? "neu"] }} />
                  <span className="flex-1 truncate">{t.name}</span>
                  <span className="text-[10px]" style={{ color: ACCENT }}>{"★".repeat(t.level)}</span>
                </button>
              ))}
            </div>
            <TrickDetail trick={trick} store={store} setStatus={setStatus} openMove={(id) => { setMoveId(id); setCat("Alle"); setTab("moves"); }} />
          </div>
        )}

        {tab === "practice" && (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              {[["Diese Woche", `${weekMin} Min.`], ["Gesamt", `${totalMin} Min.`], ["Sitzt / bühnenreif", String(known.length)], ["In Arbeit", String(learning.length)]].map(([l, v]) => (
                <div key={l} className="rounded-2xl border p-4" style={card}>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">{l}</p>
                  <p className="mt-1 text-[22px] font-semibold text-[color:var(--text-primary)]">{v}</p>
                </div>
              ))}
            </div>
            <div className="rounded-2xl border p-4" style={card}>
              <p className="text-[13px] font-semibold text-[color:var(--text-primary)]">Heute üben</p>
              <p className="text-[11px] text-[color:var(--text-muted)]">{learning.length ? "Aus deinen Techniken mit Status „lernen“ oder „üben“ – wechselt täglich." : "Setz bei Techniken den Status auf „lernen“, dann stellt Elyra dir täglich ein Programm zusammen."}</p>
              <div className="mt-3 grid gap-2 md:grid-cols-3">
                {todays.map((m) => (
                  <button key={m.id} onClick={() => { setMoveId(m.id); setCat("Alle"); setTab("moves"); }} className="rounded-xl border p-3 text-left" style={{ borderColor: "var(--os-border-soft)" }}>
                    <p className="text-[13px] font-semibold text-[color:var(--text-primary)]">{m.name}</p>
                    <p className="mt-1 text-[11px] text-[color:var(--text-secondary)]">{m.drill}</p>
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border p-4" style={card}>
              <p className="mb-2 text-[13px] font-semibold text-[color:var(--text-primary)]">Fortschritt</p>
              <div className="grid gap-1.5 md:grid-cols-2">
                {MOVES.map((m) => {
                  const s = store.status[m.id] ?? "neu";
                  return (
                    <div key={m.id} className="flex items-center gap-2 text-[12px] text-[color:var(--text-primary)]">
                      <span className="w-44 truncate">{m.name}</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: "var(--os-border-soft)" }}>
                        <div className="h-full rounded-full" style={{ width: `${(STATUSES.indexOf(s) / 4) * 100}%`, background: STATUS_COLOR[s] }} />
                      </div>
                      <span className="w-20 text-right text-[11px] capitalize" style={{ color: STATUS_COLOR[s] }}>{s}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            <p className="text-[11px] text-[color:var(--text-muted)]">Tipp: Übe schwierige Techniken vor dem Spiegel oder filme dich mit der Laptop-Kamera aus Zuschauerperspektive.</p>
          </div>
        )}

        {tab === "coach" && (
          <div className="grid gap-4 md:grid-cols-[300px_1fr]">
            <div className="space-y-3 rounded-2xl border p-4" style={card}>
              <p className="text-[12px] text-[color:var(--text-muted)]">Elly baut aus allem, was bei dir auf „sitzt“ oder „bühnenreif“ steht, eine Routine.</p>
              <div className="flex flex-wrap gap-1">
                {known.length ? known.map((k) => <span key={k} className="rounded-full px-2 py-0.5 text-[11px]" style={{ background: `color-mix(in srgb, ${ACCENT} 14%, transparent)`, color: "var(--text-primary)" }}>{k}</span>)
                  : <span className="text-[11px] text-amber-600">Noch nichts auf „sitzt“ – Elly nutzt dann einfache Grundlagen.</span>}
              </div>
              <label className="block text-[12px] text-[color:var(--text-muted)]">Dauer: {minutes} Min.
                <input type="range" min={2} max={15} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="w-full" style={{ accentColor: ACCENT }} />
              </label>
              <label className="block text-[12px] text-[color:var(--text-muted)]">Publikum
                <input value={audience} onChange={(e) => setAudience(e.target.value)} className="mt-1 w-full rounded-lg border bg-transparent px-2 py-1.5 text-[13px] text-[color:var(--text-primary)]" style={{ borderColor: "var(--os-border-soft)" }} />
              </label>
              <button onClick={() => void askCoach()} disabled={coachLoading} className="inline-flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-60" style={{ background: ACCENT }}>
                <Sparkles size={15} className={coachLoading ? "animate-pulse" : ""} /> {coachLoading ? "Elly plant…" : "Routine bauen"}
              </button>
            </div>
            <div className="rounded-2xl border p-4" style={card}>
              {coach ? (
                <>
                  <div className="text-[13px] leading-relaxed text-[color:var(--text-primary)]"><ChatMarkdown text={coach.markdown} /></div>
                  <p className="mt-3 text-[11px] text-[color:var(--text-muted)]">{coach.source === "model" ? `Von Elly (${coach.model ?? "Gemini"})` : "Beispielroutine – KI gerade nicht erreichbar"}</p>
                </>
              ) : <p className="text-[13px] text-[color:var(--text-muted)]">Wähle Dauer und Publikum – Elly schlägt Reihenfolge, Übergänge und eigene Präsentationsideen vor.</p>}
            </div>
          </div>
        )}
        <p className="mt-5 text-[10.5px] text-[color:var(--text-muted)]">
          Techniken in eigenen Worten erklärt. Zum Vertiefen: Hugard &amp; Braué – „The Royal Road to Card Magic“, Roberto Giobbi – „Card College“, S. W. Erdnase – „The Expert at the Card Table“ (1902, gemeinfrei).
        </p>
      </div>
    </div>
  );
}
