"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Languages, RotateCcw, Send, Sparkles, Volume2, X } from "lucide-react";
import { LANGUAGES, LEVELS, TOPICS } from "./languageList";

/**
 * Lernen › Sprachen — language trainer with Elly (60+ languages):
 * flashcards with pronunciation, quiz and conversation practice with corrections.
 */

type Item = { term: string; translation: string; example: string; exampleTranslation: string; pronunciation?: string };
type Deck = { language: string; level: string; topic: string; items: Item[]; known: string[]; createdAt: number };
type Mode = "cards" | "quiz" | "chat";
type ChatMsg = { role: "user" | "assistant"; content: string; translation?: string | undefined; correction?: string | undefined };

const ACCENT = "#0ea5e9";
const card = { borderColor: "var(--os-border-soft)", background: "var(--bg-surface)" } as const;
const field = { borderColor: "var(--os-border-soft)" } as const;

function load<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

function speak(text: string, code: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = code;
  const voices = window.speechSynthesis.getVoices();
  const voice = voices.find((v) => v.lang === code) ?? voices.find((v) => v.lang.toLowerCase().startsWith(code.slice(0, 2).toLowerCase()));
  if (voice) u.voice = voice;
  u.rate = 0.9;
  window.speechSynthesis.speak(u);
}

function SpeakButton({ text, code, small }: { text: string; code: string; small?: boolean }) {
  return (
    <button onClick={(e) => { e.stopPropagation(); speak(text, code); }} title="Anhören" className="inline-flex items-center justify-center rounded-full border p-1.5"
      style={{ borderColor: "var(--os-border-soft)", color: ACCENT }}>
      <Volume2 size={small ? 12 : 15} />
    </button>
  );
}

// ── Flashcards ───────────────────────────────────────────────────────────────

function Cards({ deck, code, onKnown, onReset }: { deck: Deck; code: string; onKnown: (term: string, known: boolean) => void; onReset: () => void }) {
  const open = deck.items.filter((i) => !deck.known.includes(i.term));
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const item = open[idx % Math.max(open.length, 1)];
  useEffect(() => { setFlipped(false); }, [idx, deck.createdAt]);

  if (!open.length) {
    return (
      <div className="mx-auto max-w-[520px] rounded-2xl border p-8 text-center" style={card}>
        <p className="text-[22px]">🎉</p>
        <p className="mt-2 text-[15px] font-semibold text-[color:var(--text-primary)]">Alle {deck.items.length} Karten gewusst!</p>
        <p className="mt-1 text-[12px] text-[color:var(--text-muted)]">Mach das Quiz oder hol dir neue Karten von Elly.</p>
        <button onClick={onReset} className="mt-4 inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[12px]" style={field}><RotateCcw size={13} /> Nochmal üben</button>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-[560px]">
      <div className="mb-2 flex items-center justify-between text-[12px] text-[color:var(--text-muted)]">
        <span>{deck.known.length} von {deck.items.length} gewusst</span>
        <span>Karte antippen zum Umdrehen</span>
      </div>
      <div className="mb-3 h-1.5 overflow-hidden rounded-full" style={{ background: "var(--os-border-soft)" }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${(deck.known.length / deck.items.length) * 100}%`, background: ACCENT }} />
      </div>
      <div onClick={() => setFlipped((f) => !f)} className="flex min-h-[230px] cursor-pointer flex-col items-center justify-center rounded-3xl border p-6 text-center" style={card}>
        {!flipped ? (
          <>
            <p className="text-[28px] font-semibold leading-tight text-[color:var(--text-primary)]">{item!.term}</p>
            {item!.pronunciation ? <p className="mt-1 text-[13px] text-[color:var(--text-muted)]">[{item!.pronunciation}]</p> : null}
            <div className="mt-3"><SpeakButton text={item!.term} code={code} /></div>
          </>
        ) : (
          <>
            <p className="text-[22px] font-semibold text-[color:var(--text-primary)]">{item!.translation}</p>
            <div className="mt-4 flex items-center gap-2 text-[14px] text-[color:var(--text-secondary)]">
              <span>{item!.example}</span><SpeakButton text={item!.example} code={code} small />
            </div>
            <p className="mt-1 text-[12px] italic text-[color:var(--text-muted)]">{item!.exampleTranslation}</p>
          </>
        )}
      </div>
      <div className="mt-3 flex justify-center gap-2">
        <button onClick={() => { onKnown(item!.term, false); setIdx((i) => i + 1); }} className="inline-flex items-center gap-1.5 rounded-xl border px-4 py-2 text-[13px] text-[color:var(--text-primary)]" style={field}>
          <X size={15} /> Nochmal
        </button>
        <button onClick={() => { onKnown(item!.term, true); setIdx((i) => i); }} className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-[13px] font-semibold text-white" style={{ background: "#16a34a" }}>
          <Check size={15} /> Gewusst
        </button>
      </div>
    </div>
  );
}

// ── Quiz ─────────────────────────────────────────────────────────────────────

function Quiz({ deck, code }: { deck: Deck; code: string }) {
  const [reverse, setReverse] = useState(false);
  const [round, setRound] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [score, setScore] = useState({ right: 0, total: 0 });
  const q = useMemo(() => {
    if (deck.items.length < 2) return null;
    const item = deck.items[Math.floor(Math.random() * deck.items.length)]!;
    const others = deck.items.filter((i) => i !== item).sort(() => Math.random() - 0.5).slice(0, 3);
    const answer = reverse ? item.term : item.translation;
    const options = [item, ...others].map((i) => (reverse ? i.term : i.translation)).sort(() => Math.random() - 0.5);
    return { item, question: reverse ? item.translation : item.term, answer, options };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round, reverse, deck.createdAt]);
  if (!q) return <p className="text-[13px] text-[color:var(--text-muted)]">Für das Quiz brauchst du mindestens 2 Karten.</p>;
  const choose = (o: string) => {
    if (picked) return;
    setPicked(o);
    setScore((s) => ({ right: s.right + (o === q.answer ? 1 : 0), total: s.total + 1 }));
    if (!reverse) speak(q.item.term, code);
  };
  return (
    <div className="mx-auto max-w-[560px]">
      <div className="mb-3 flex items-center justify-between text-[12px] text-[color:var(--text-muted)]">
        <span>Punkte: {score.right}/{score.total}</span>
        <button onClick={() => { setReverse((r) => !r); setPicked(null); setRound((r) => r + 1); }} className="rounded-lg border px-2 py-1" style={field}>
          Richtung: {reverse ? "Deutsch → Zielsprache" : "Zielsprache → Deutsch"}
        </button>
      </div>
      <div className="rounded-3xl border p-6 text-center" style={card}>
        <p className="text-[12px] text-[color:var(--text-muted)]">Was heißt…</p>
        <p className="mt-1 text-[26px] font-semibold text-[color:var(--text-primary)]">{q.question}</p>
        {!reverse ? <div className="mt-2"><SpeakButton text={q.question} code={code} /></div> : null}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {q.options.map((o) => {
          const right = picked && o === q.answer, wrong = picked === o && o !== q.answer;
          return (
            <button key={o} onClick={() => choose(o)} className="rounded-xl border px-3 py-3 text-[14px] text-[color:var(--text-primary)]"
              style={{ borderColor: right ? "#16a34a" : wrong ? "#dc2626" : "var(--os-border-soft)", background: right ? "color-mix(in srgb,#16a34a 12%,transparent)" : wrong ? "color-mix(in srgb,#dc2626 10%,transparent)" : "var(--bg-surface)" }}>
              {o}
            </button>
          );
        })}
      </div>
      {picked ? (
        <div className="mt-3 text-center">
          <p className="text-[12px] text-[color:var(--text-secondary)]">{q.item.example} – <i>{q.item.exampleTranslation}</i></p>
          <button onClick={() => { setPicked(null); setRound((r) => r + 1); }} className="mt-2 rounded-xl px-4 py-2 text-[13px] font-semibold text-white" style={{ background: ACCENT }}>Nächste Frage</button>
        </div>
      ) : null}
    </div>
  );
}

// ── Conversation ─────────────────────────────────────────────────────────────

function Chat({ language, code, level, topic }: { language: string; code: string; level: string; topic: string }) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTr, setShowTr] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { setMsgs([]); setError(null); }, [language, level, topic]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  const call = async (payload: Record<string, unknown>, history: ChatMsg[]) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/os/learn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "chat", language, level, topic, history: history.map((m) => ({ role: m.role, content: m.content })), ...payload }),
      });
      const data = (await res.json()) as { reply?: string; translation?: string; correction?: string; error?: string };
      if (!data.reply) throw new Error(data.error || "Keine Antwort");
      return data;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const startChat = async () => {
    const data = await call({ start: true }, []);
    if (data) setMsgs([{ role: "assistant", content: data.reply!, translation: data.translation }]);
  };
  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    const history = [...msgs, { role: "user" as const, content: text }];
    setMsgs(history);
    const data = await call({ message: text }, msgs);
    if (!data) return;
    setMsgs((cur) => {
      const copy = [...cur];
      const last = copy[copy.length - 1];
      if (last && last.role === "user" && data.correction) copy[copy.length - 1] = { ...last, correction: data.correction };
      return [...copy, { role: "assistant", content: data.reply!, translation: data.translation }];
    });
  };

  return (
    <div className="mx-auto flex h-full max-w-[680px] flex-col">
      <div className="mb-2 flex items-center justify-between text-[12px] text-[color:var(--text-muted)]">
        <span>Gespräch auf {language} · {level} · {topic}</span>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={showTr} onChange={(e) => setShowTr(e.target.checked)} /> Übersetzung zeigen</label>
      </div>
      <div className="min-h-[260px] flex-1 space-y-2 overflow-y-auto rounded-2xl border p-3" style={card}>
        {!msgs.length ? (
          <div className="flex h-full flex-col items-center justify-center py-10 text-center">
            <p className="text-[13px] text-[color:var(--text-secondary)]">Übe ein echtes Gespräch mit Elly. Sie antwortet in {language}, passend zu deinem Niveau, und korrigiert deine Fehler.</p>
            <button onClick={() => void startChat()} disabled={busy} className="mt-3 inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-60" style={{ background: ACCENT }}>
              <Sparkles size={14} className={busy ? "animate-pulse" : ""} /> {busy ? "Elly startet…" : "Gespräch starten"}
            </button>
          </div>
        ) : msgs.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className="max-w-[85%] rounded-2xl px-3 py-2 text-[13.5px]"
              style={{ background: m.role === "user" ? `color-mix(in srgb, ${ACCENT} 14%, transparent)` : "var(--bg-elevated)", color: "var(--text-primary)" }}>
              <div className="flex items-start gap-2">
                <span className="whitespace-pre-wrap">{m.content}</span>
                {m.role === "assistant" ? <SpeakButton text={m.content} code={code} small /> : null}
              </div>
              {m.role === "assistant" && showTr && m.translation ? <p className="mt-1 text-[12px] italic text-[color:var(--text-muted)]">{m.translation}</p> : null}
              {m.correction ? <p className="mt-1.5 rounded-lg px-2 py-1 text-[12px]" style={{ background: "color-mix(in srgb,#f59e0b 14%,transparent)", color: "var(--text-secondary)" }}>✏️ {m.correction}</p> : null}
            </div>
          </div>
        ))}
        {busy && msgs.length ? <p className="text-[12px] text-[color:var(--text-muted)]">Elly schreibt…</p> : null}
        <div ref={endRef} />
      </div>
      {error ? <p className="mt-1 text-[12px] text-red-500">{error}</p> : null}
      <div className="mt-2 flex gap-2">
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void send(); }} disabled={!msgs.length}
          placeholder={msgs.length ? `Antworte auf ${language}…` : "Starte zuerst das Gespräch"} className="flex-1 rounded-xl border bg-transparent px-3 py-2 text-[13px] text-[color:var(--text-primary)]" style={field} />
        <button onClick={() => void send()} disabled={busy || !input.trim()} className="rounded-xl px-3 text-white disabled:opacity-50" style={{ background: ACCENT }}><Send size={16} /></button>
      </div>
    </div>
  );
}

// ── Window ───────────────────────────────────────────────────────────────────

export default function LanguagesWindow() {
  const [language, setLanguage] = useState("Portugiesisch (Portugal)");
  const [level, setLevel] = useState<string>("A1");
  const [topic, setTopic] = useState(TOPICS[0]!);
  const [customTopic, setCustomTopic] = useState("");
  const [mode, setMode] = useState<Mode>("cards");
  const [deck, setDeck] = useState<Deck | null>(null);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const code = LANGUAGES.find((l) => l.name === language)?.code ?? "en-US";
  const deckKey = `elyra:lang:deck:${language}`;
  const effectiveTopic = customTopic.trim() || topic;

  useEffect(() => {
    const saved = load<{ language: string } | null>("elyra:lang:settings", null);
    if (saved?.language) setLanguage(saved.language);
  }, []);
  useEffect(() => {
    save("elyra:lang:settings", { language });
    setDeck(load<Deck | null>(`elyra:lang:deck:${language}`, null));
    setNote(null);
  }, [language]);
  // Preload speech voices (Chrome loads them async).
  useEffect(() => { if ("speechSynthesis" in window) window.speechSynthesis.getVoices(); }, []);

  const updateDeck = useCallback((next: Deck) => { setDeck(next); save(deckKey, next); }, [deckKey]);

  const generate = async () => {
    setLoading(true);
    setNote(null);
    try {
      const res = await fetch("/api/os/learn", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "vocab", language, level, topic: effectiveTopic, count: 12 }) });
      const data = (await res.json()) as { items?: Item[]; note?: string; source?: string };
      if (data.items?.length) updateDeck({ language, level, topic: effectiveTopic, items: data.items, known: [], createdAt: Date.now() });
      setNote(data.note ?? null);
    } catch {
      setNote("Konnte keine Karten laden.");
    } finally {
      setLoading(false);
    }
  };

  const markKnown = (term: string, known: boolean) => {
    if (!deck) return;
    const set = new Set(deck.known);
    if (known) set.add(term); else set.delete(term);
    updateDeck({ ...deck, known: [...set] });
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b px-5 py-3" style={{ borderColor: "var(--os-border-soft)" }}>
        <Languages size={18} style={{ color: ACCENT }} />
        <h1 className="text-[15px] font-semibold text-[color:var(--text-primary)]">Sprachen</h1>
        <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: `color-mix(in srgb, ${ACCENT} 16%, transparent)`, color: ACCENT }}>{LANGUAGES.length} SPRACHEN · MIT ELLY</span>
        <div className="ml-auto flex gap-1">
          {([["cards", "Karteikarten"], ["quiz", "Quiz"], ["chat", "Gespräch"]] as const).map(([id, label]) => (
            <button key={id} onClick={() => setMode(id)} className="rounded-lg px-3 py-1.5 text-[12px] font-medium"
              style={{ background: mode === id ? `color-mix(in srgb, ${ACCENT} 16%, transparent)` : "transparent", color: mode === id ? ACCENT : "var(--text-secondary)" }}>{label}</button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 border-b px-5 py-3" style={{ borderColor: "var(--os-border-soft)" }}>
        <label className="text-[11px] text-[color:var(--text-muted)]">Sprache
          <select value={language} onChange={(e) => setLanguage(e.target.value)} className="mt-1 block rounded-lg border bg-transparent px-2 py-1.5 text-[13px] text-[color:var(--text-primary)]" style={field}>
            {LANGUAGES.map((l) => <option key={l.name}>{l.name}</option>)}
          </select>
        </label>
        <label className="text-[11px] text-[color:var(--text-muted)]">Niveau
          <select value={level} onChange={(e) => setLevel(e.target.value)} className="mt-1 block rounded-lg border bg-transparent px-2 py-1.5 text-[13px] text-[color:var(--text-primary)]" style={field}>
            {LEVELS.map((l) => <option key={l}>{l}</option>)}
          </select>
        </label>
        <label className="text-[11px] text-[color:var(--text-muted)]">Thema
          <select value={topic} onChange={(e) => setTopic(e.target.value)} className="mt-1 block rounded-lg border bg-transparent px-2 py-1.5 text-[13px] text-[color:var(--text-primary)]" style={field}>
            {TOPICS.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label className="text-[11px] text-[color:var(--text-muted)]">oder eigenes Thema
          <input value={customTopic} onChange={(e) => setCustomTopic(e.target.value)} placeholder="z. B. Surfen" className="mt-1 block w-40 rounded-lg border bg-transparent px-2 py-1.5 text-[13px] text-[color:var(--text-primary)]" style={field} />
        </label>
        {mode !== "chat" ? (
          <button onClick={() => void generate()} disabled={loading} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-60" style={{ background: ACCENT }}>
            <Sparkles size={14} className={loading ? "animate-pulse" : ""} /> {loading ? "Elly erstellt…" : deck ? "Neue Karten" : "Karten erstellen"}
          </button>
        ) : null}
        {deck && mode !== "chat" ? <span className="text-[11px] text-[color:var(--text-muted)]">Aktuell: {deck.topic} · {deck.level} · {deck.items.length} Karten</span> : null}
      </div>

      <div className="flex-1 overflow-auto p-5">
        {note ? <p className="mb-3 text-center text-[12px] text-amber-600">{note}</p> : null}
        {mode === "chat" ? (
          <Chat language={language} code={code} level={level} topic={effectiveTopic} />
        ) : !deck ? (
          <div className="mx-auto max-w-[520px] rounded-2xl border p-8 text-center" style={card}>
            <p className="text-[15px] font-semibold text-[color:var(--text-primary)]">Wähle Sprache, Niveau und Thema</p>
            <p className="mt-1 text-[13px] text-[color:var(--text-muted)]">Elly erstellt dir passende Karteikarten mit Beispielsätzen und Aussprache. Dein Fortschritt wird pro Sprache gespeichert.</p>
          </div>
        ) : mode === "cards" ? (
          <Cards deck={deck} code={code} onKnown={markKnown} onReset={() => updateDeck({ ...deck, known: [] })} />
        ) : (
          <Quiz deck={deck} code={code} />
        )}
      </div>
    </div>
  );
}
