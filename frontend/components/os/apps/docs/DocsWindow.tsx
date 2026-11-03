"use client";

import { useState, useRef, useEffect } from "react";
import {
  FileText,
  Search,
  Plus,
  Tag,
  Clock,
  Star,
  StarOff,
  MoreHorizontal,
  Bold,
  Italic,
  List,
  Heading2,
  Code,
  Link,
  Trash2,
  Share2,
  ChevronRight,
  Sparkles,
  Check,
  X,
  Loader2,
} from "lucide-react";

type DocTag = "design" | "engineering" | "strategy" | "personal" | "meeting";

type Doc = {
  id: string;
  title: string;
  body: string;
  tag: DocTag;
  starred: boolean;
  owner: string;
  updatedAt: string;
  wordCount?: number;
};

const TAG_COLORS: Record<DocTag, { bg: string; text: string; label: string }> = {
  design:      { bg: "rgba(168,85,247,0.18)", text: "rgba(192,132,252,1)", label: "Design" },
  engineering: { bg: "rgba(59,130,246,0.18)", text: "rgba(96,165,250,1)",  label: "Engineering" },
  strategy:    { bg: "rgba(236,72,153,0.18)", text: "rgba(244,114,182,1)", label: "Strategy" },
  personal:    { bg: "rgba(34,197,94,0.18)",  text: "rgba(74,222,128,1)",  label: "Personal" },
  meeting:     { bg: "rgba(251,191,36,0.18)", text: "rgba(253,224,71,1)",  label: "Meeting" },
};

const INITIAL_DOCS: Doc[] = [
  {
    id: "doc-1",
    title: "Launch Plan Q2 2025",
    body: `# Launch Plan Q2 2025\n\n## Overview\nThis document outlines the milestones and owners for our next release.\n\n## Milestones\n\n**M1 — Alpha (Week 2)**\n- Core OS shell complete\n- AI intent routing stable\n- Internal demo ready\n\n**M2 — Beta (Week 5)**\n- All 7 apps shipped\n- Weather & surf forecast live\n- Performance baseline set\n\n**M3 — Launch (Week 8)**\n- Public release\n- Marketing site live\n- Onboarding flow polished\n\n## Owners\n- Shell & AI: @paul\n- Design system: @elli\n- Marketing: @team`,
    tag: "strategy",
    starred: true,
    owner: "Paul",
    updatedAt: "2 hours ago",
    wordCount: 82,
  },
  {
    id: "doc-2",
    title: "Design Principles",
    body: `# Design Principles\n\n## Core Philosophy\nElyra is built on the principle that software should feel alive. Every interaction should be intentional, fluid, and delightful.\n\n## Key Principles\n\n**1. Motion with purpose**\nAnimations communicate state, not decoration. Every transition earns its place.\n\n**2. Information density without clutter**\nShow what matters. Hide what doesn't. Reveal on demand.\n\n**3. Glass + depth**\nLayers create spatial hierarchy. The OS shell lives below. Content lives above.\n\n**4. AI as co-pilot**\nThe orb is always listening, never intrusive. One keystroke away.\n\n## Visual System\n- 7 themes with full CSS variable coverage\n- Radius: pill for interactive, xl for panels\n- Blur: 2xl for rails, xl for cards`,
    tag: "design",
    starred: true,
    owner: "Elli",
    updatedAt: "Yesterday",
    wordCount: 110,
  },
  {
    id: "doc-3",
    title: "Partner Sync Notes — March",
    body: `# Partner Sync Notes — March 2025\n\n**Date**: March 3, 2025\n**Attendees**: Paul, Sarah (VC), Marcus (BD)\n\n## Action Items\n\n- [ ] Send updated deck by Friday\n- [ ] Schedule technical deep-dive with engineering team\n- [ ] Prepare demo environment for due diligence\n- [ ] Follow up on NDA status\n\n## Key Discussion Points\n\nSarah raised concerns about the B2B monetization timeline. Agreed to push the enterprise tier announcement to Q3.\n\nMarcus confirmed interest from two potential distribution partners. Will make introductions next week.\n\n## Next Meeting\nApril 7, 2025 — same time.`,
    tag: "meeting",
    starred: false,
    owner: "Paul",
    updatedAt: "3 days ago",
    wordCount: 97,
  },
  {
    id: "doc-4",
    title: "API Architecture Notes",
    body: `# API Architecture Notes\n\n## Current Stack\n\n- **Runtime**: Cloudflare Workers (edge)\n- **AI**: Gemini 2.0 Flash via Vertex AI\n- **DB**: Supabase (Postgres + realtime)\n- **Storage**: Cloudflare R2\n- **Auth**: Supabase Auth + JWT\n\n## Intent Routing\n\nAll user intents flow through \`/api/os/runs\`:\n\n\`\`\`\nPOST /api/os/runs\n{ intent: string, workspaceId: string }\n→ SSE stream of IntentStep events\n\`\`\`\n\n## Rate Limits\n- Free: 100 runs/day\n- Pro: 2,000 runs/day\n- Enterprise: unlimited`,
    tag: "engineering",
    starred: false,
    owner: "Paul",
    updatedAt: "5 days ago",
    wordCount: 99,
  },
  {
    id: "doc-5",
    title: "Weekly Reflection",
    body: `# Weekly Reflection — Week 9\n\n## What went well\n- Shipped slides app with Gemini generation\n- Builder workflow editor complete\n- Admin settings panel polished\n\n## What was hard\n- TypeScript exactOptionalPropertyTypes fights\n- Context window pressure on long sessions\n\n## Learnings\nBreaking work into smaller composable pieces keeps the AI sessions clean. One big rewrite per session is the limit.\n\n## Next week\n- Plan mode overlay\n- Weather surf forecast\n- Deploy to Cloudflare`,
    tag: "personal",
    starred: false,
    owner: "Paul",
    updatedAt: "1 week ago",
    wordCount: 76,
  },
];

type FilterKey = "all" | "starred" | DocTag;

const TOOLBAR_ACTIONS = [
  { icon: Heading2, label: "Heading", markdown: "## " },
  { icon: Bold, label: "Bold", markdown: "**text**" },
  { icon: Italic, label: "Italic", markdown: "_text_" },
  { icon: List, label: "List", markdown: "- " },
  { icon: Code, label: "Code", markdown: "`code`" },
  { icon: Link, label: "Link", markdown: "[text](url)" },
];

// Approval gate state: pending AI mutation waiting for user to approve/reject
type PendingMutation = {
  prompt: string;
  proposedBody: string;
};

export default function DocsWindow() {
  const [docs, setDocs] = useState<Doc[]>(INITIAL_DOCS);
  const [selectedId, setSelectedId] = useState<string>(INITIAL_DOCS[0]!.id);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [editTitle, setEditTitle] = useState(false);
  const [showProperties, setShowProperties] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  // Elly AI bar state
  const [ellyPrompt, setEllyPrompt] = useState("");
  const [ellyLoading, setEllyLoading] = useState(false);
  const [ellyError, setEllyError] = useState<string | null>(null);
  // Approval gate: holds the proposed mutation until the user approves or rejects
  const [pendingMutation, setPendingMutation] = useState<PendingMutation | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const ellyInputRef = useRef<HTMLInputElement>(null);

  const selected = docs.find((d) => d.id === selectedId) ?? docs[0]!;

  const filtered = docs.filter((doc) => {
    const matchSearch =
      !search ||
      doc.title.toLowerCase().includes(search.toLowerCase()) ||
      doc.body.toLowerCase().includes(search.toLowerCase());
    if (!matchSearch) return false;
    if (filter === "all") return true;
    if (filter === "starred") return doc.starred;
    return doc.tag === filter;
  });

  function updateDoc(id: string, patch: Partial<Doc>) {
    setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  function createDoc() {
    const newDoc: Doc = {
      id: `doc-${Date.now()}`,
      title: "Untitled",
      body: "# Untitled\n\nStart writing...",
      tag: "personal",
      starred: false,
      owner: "Paul",
      updatedAt: "Just now",
      wordCount: 0,
    };
    setDocs((prev) => [newDoc, ...prev]);
    setSelectedId(newDoc.id);
    setEditTitle(true);
    setTimeout(() => titleRef.current?.focus(), 50);
  }

  function deleteDoc(id: string) {
    setDocs((prev) => prev.filter((d) => d.id !== id));
    const remaining = docs.filter((d) => d.id !== id);
    if (remaining.length > 0) setSelectedId(remaining[0]!.id);
  }

  function handleBodyChange(val: string) {
    const words = val.trim().split(/\s+/).filter(Boolean).length;
    updateDoc(selected.id, { body: val, updatedAt: "Just now", wordCount: words });
  }

  function insertMarkdown(md: string) {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const body = selected.body;
    const newBody = body.slice(0, start) + md + body.slice(end);
    handleBodyChange(newBody);
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(start + md.length, start + md.length);
    }, 10);
  }

  // ── Elly AI: ask Elly to edit the current document ──────────────────────
  async function handleEllySubmit(e: React.FormEvent) {
    e.preventDefault();
    const prompt = ellyPrompt.trim();
    if (!prompt || ellyLoading) return;

    setEllyLoading(true);
    setEllyError(null);
    abortRef.current = new AbortController();

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortRef.current.signal,
        body: JSON.stringify({
          messages: [
            {
              role: "user",
              content:
                `You are editing a document for the user. Return ONLY the new full document body (markdown), no explanation, no code fences.\n\nCurrent document title: "${selected.title}"\n\nCurrent document body:\n${selected.body}\n\nUser instruction: ${prompt}`,
            },
          ],
          stream: false,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `AI request failed (${res.status})`);
      }

      const data = await res.json() as { message?: { content?: string }; content?: string; text?: string };
      const proposed = (
        data.message?.content ??
        data.content ??
        data.text ??
        ""
      ).trim();

      if (!proposed) throw new Error("Elly returned an empty response");

      // Show approval gate — do NOT apply yet
      setPendingMutation({ prompt, proposedBody: proposed });
      setEllyPrompt("");
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      setEllyError(err instanceof Error ? err.message : String(err));
    } finally {
      setEllyLoading(false);
    }
  }

  function approveMutation() {
    if (!pendingMutation) return;
    handleBodyChange(pendingMutation.proposedBody);
    setPendingMutation(null);
  }

  function rejectMutation() {
    setPendingMutation(null);
    setTimeout(() => ellyInputRef.current?.focus(), 50);
  }

  useEffect(() => {
    if (editTitle && titleRef.current) {
      titleRef.current.focus();
      titleRef.current.select();
    }
  }, [editTitle]);

  // Cancel in-flight Elly request on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  const tag = TAG_COLORS[selected.tag];

  return (
    <div className="flex h-full overflow-hidden" style={{ background: "var(--bg-canvas)" }}>

      {/* ─── Left sidebar ─────────────────────────────────────── */}
      <aside
        className="flex w-56 flex-shrink-0 flex-col border-r"
        style={{ borderColor: "var(--os-border-faint)", background: "var(--bg-elevated)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-3 py-3" style={{ borderColor: "var(--os-border-faint)" }}>
          <div className="flex items-center gap-1.5">
            <FileText size={13} style={{ color: "var(--os-accent)" }} />
            <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>Docs</span>
          </div>
          <button
            type="button"
            onClick={createDoc}
            className="flex h-6 w-6 items-center justify-center rounded-lg transition hover:bg-white/10"
            title="New document"
          >
            <Plus size={13} style={{ color: "var(--text-secondary)" }} />
          </button>
        </div>

        {/* Search */}
        <div className="px-2 py-2">
          <div
            className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5"
            style={{ borderColor: "var(--os-border-faint)", background: "var(--bg-surface)" }}
          >
            <Search size={11} style={{ color: "var(--text-tertiary)" }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search docs..."
              className="flex-1 bg-transparent text-[11px] outline-none placeholder:text-[color:var(--text-tertiary)]"
              style={{ color: "var(--text-primary)" }}
            />
          </div>
        </div>

        {/* Filters */}
        <div className="border-b px-2 pb-2" style={{ borderColor: "var(--os-border-faint)" }}>
          {([
            ["all", "All Docs"],
            ["starred", "Starred"],
          ] as [FilterKey, string][]).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] transition"
              style={{
                background: filter === key ? "rgba(255,255,255,0.07)" : "transparent",
                color: filter === key ? "var(--text-primary)" : "var(--text-secondary)",
              }}
            >
              {key === "starred" && <Star size={10} style={{ color: "rgba(251,191,36,0.8)" }} />}
              {label}
            </button>
          ))}
          <div className="mt-1.5 mb-1 px-2 text-[9px] uppercase tracking-[0.12em]" style={{ color: "var(--text-tertiary)" }}>
            By Tag
          </div>
          {(Object.keys(TAG_COLORS) as DocTag[]).map((t) => {
            const tc = TAG_COLORS[t];
            return (
              <button
                key={t}
                type="button"
                onClick={() => setFilter(t)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] transition"
                style={{
                  background: filter === t ? "rgba(255,255,255,0.07)" : "transparent",
                  color: filter === t ? "var(--text-primary)" : "var(--text-secondary)",
                }}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full flex-shrink-0"
                  style={{ background: tc.text }}
                />
                {tc.label}
              </button>
            );
          })}
        </div>

        {/* Doc list */}
        <ul className="flex-1 overflow-y-auto py-1">
          {filtered.length === 0 && (
            <li className="px-4 py-6 text-center text-[11px]" style={{ color: "var(--text-tertiary)" }}>
              No documents found
            </li>
          )}
          {filtered.map((doc) => {
            const active = doc.id === selectedId;
            const tc = TAG_COLORS[doc.tag];
            return (
              <li key={doc.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(doc.id)}
                  className="group flex w-full items-start gap-2.5 px-2.5 py-2 text-left transition"
                  style={{
                    background: active ? "rgba(255,255,255,0.07)" : "transparent",
                    borderLeft: active ? `2px solid ${tc.text}` : "2px solid transparent",
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <p
                        className="truncate text-[11px] font-medium"
                        style={{ color: active ? "var(--text-primary)" : "var(--text-secondary)" }}
                      >
                        {doc.title}
                      </p>
                      {doc.starred && <Star size={8} style={{ color: "rgba(251,191,36,0.7)", flexShrink: 0 }} />}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <span
                        className="rounded-full px-1.5 py-0.5 text-[8px] font-medium"
                        style={{ background: tc.bg, color: tc.text }}
                      >
                        {tc.label}
                      </span>
                      <span className="text-[9px]" style={{ color: "var(--text-tertiary)" }}>
                        {doc.updatedAt}
                      </span>
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      {/* ─── Editor ───────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">

        {/* Editor toolbar */}
        <div
          className="flex items-center gap-1 border-b px-4 py-2"
          style={{ borderColor: "var(--os-border-faint)", background: "var(--bg-elevated)" }}
        >
          {/* Breadcrumb */}
          <div className="flex items-center gap-1 text-[10px]" style={{ color: "var(--text-tertiary)" }}>
            <span>Docs</span>
            <ChevronRight size={10} />
            <span
              className="rounded-full px-1.5 py-0.5 text-[8px] font-medium"
              style={{ background: tag.bg, color: tag.text }}
            >
              {tag.label}
            </span>
          </div>

          <div className="flex-1" />

          {/* Format buttons */}
          <div className="flex items-center gap-0.5">
            {TOOLBAR_ACTIONS.map(({ icon: Icon, label, markdown }) => (
              <button
                key={label}
                type="button"
                title={label}
                onClick={() => insertMarkdown(markdown)}
                className="flex h-6 w-6 items-center justify-center rounded-md transition hover:bg-white/10"
                style={{ color: "var(--text-tertiary)" }}
              >
                <Icon size={11} />
              </button>
            ))}
          </div>

          <div className="mx-2 h-4 w-px" style={{ background: "var(--os-border-faint)" }} />

          {/* Actions */}
          <button
            type="button"
            title={selected.starred ? "Unstar" : "Star"}
            onClick={() => updateDoc(selected.id, { starred: !selected.starred })}
            className="flex h-6 w-6 items-center justify-center rounded-md transition hover:bg-white/10"
          >
            {selected.starred
              ? <Star size={11} style={{ color: "rgba(251,191,36,0.9)" }} />
              : <StarOff size={11} style={{ color: "var(--text-tertiary)" }} />}
          </button>
          <button
            type="button"
            title="Properties"
            onClick={() => setShowProperties((v) => !v)}
            className="flex h-6 w-6 items-center justify-center rounded-md transition hover:bg-white/10"
            style={{ color: showProperties ? "var(--os-accent)" : "var(--text-tertiary)" }}
          >
            <MoreHorizontal size={11} />
          </button>
          <button
            type="button"
            title="Delete document"
            onClick={() => deleteDoc(selected.id)}
            className="flex h-6 w-6 items-center justify-center rounded-md transition hover:bg-red-500/20"
            style={{ color: "var(--text-tertiary)" }}
          >
            <Trash2 size={11} />
          </button>
        </div>

        {/* Title */}
        <div className="border-b px-8 py-4" style={{ borderColor: "var(--os-border-faint)" }}>
          {editTitle ? (
            <input
              ref={titleRef}
              type="text"
              value={selected.title}
              onChange={(e) => updateDoc(selected.id, { title: e.target.value })}
              onBlur={() => setEditTitle(false)}
              onKeyDown={(e) => { if (e.key === "Enter") setEditTitle(false); }}
              className="w-full bg-transparent text-2xl font-bold outline-none"
              style={{ color: "var(--text-primary)" }}
            />
          ) : (
            <h2
              className="cursor-text text-2xl font-bold transition-opacity hover:opacity-80"
              style={{ color: "var(--text-primary)" }}
              onClick={() => setEditTitle(true)}
            >
              {selected.title}
            </h2>
          )}
          <div className="mt-1.5 flex items-center gap-3 text-[10px]" style={{ color: "var(--text-tertiary)" }}>
            <span className="flex items-center gap-1">
              <Clock size={9} />
              Updated {selected.updatedAt}
            </span>
            <span className="flex items-center gap-1">
              <Tag size={9} />
              <span
                className="rounded-full px-1.5 py-0.5 font-medium"
                style={{ background: tag.bg, color: tag.text }}
              >
                {tag.label}
              </span>
            </span>
            {selected.wordCount !== undefined && (
              <span>{selected.wordCount} words</span>
            )}
          </div>
        </div>

        {/* ── Approval gate overlay: shown while a pending mutation awaits user review ── */}
        {pendingMutation && (
          <div
            className="border-b px-8 py-3"
            style={{
              borderColor: "var(--os-border-faint)",
              background: "rgba(99,102,241,0.08)",
            }}
          >
            <div className="mb-2 flex items-center gap-2">
              <Sparkles size={11} style={{ color: "var(--os-accent)" }} />
              <span className="text-[11px] font-medium" style={{ color: "var(--os-accent)" }}>
                Elly proposes a change
              </span>
              <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
                — review before applying
              </span>
            </div>
            <p className="mb-2 text-[10px] italic" style={{ color: "var(--text-secondary)" }}>
              &ldquo;{pendingMutation.prompt}&rdquo;
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={approveMutation}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium transition hover:opacity-90"
                style={{ background: "var(--os-accent)", color: "#fff" }}
              >
                <Check size={11} />
                Approve &amp; apply
              </button>
              <button
                type="button"
                onClick={rejectMutation}
                className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] transition hover:bg-white/10"
                style={{ borderColor: "var(--os-border-faint)", color: "var(--text-secondary)" }}
              >
                <X size={11} />
                Reject
              </button>
            </div>
          </div>
        )}

        {/* Body editor */}
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <textarea
            ref={textareaRef}
            value={selected.body}
            onChange={(e) => handleBodyChange(e.target.value)}
            className="h-full w-full resize-none px-8 py-5 text-sm leading-relaxed outline-none"
            style={{
              background: "var(--bg-canvas)",
              color: "var(--text-secondary)",
              fontFamily: "'Geist Mono', 'Fira Code', 'SF Mono', monospace",
              fontSize: 12.5,
              lineHeight: 1.8,
            }}
            spellCheck={false}
            placeholder="Start writing..."
          />
        </div>

        {/* ── Elly AI bar ───────────────────────────────────────── */}
        <form
          onSubmit={handleEllySubmit}
          className="flex items-center gap-2 border-t px-4 py-2"
          style={{ borderColor: "var(--os-border-faint)", background: "var(--bg-elevated)" }}
        >
          <Sparkles size={12} style={{ color: ellyLoading ? "var(--os-accent)" : "var(--text-tertiary)", flexShrink: 0 }} />
          <input
            ref={ellyInputRef}
            type="text"
            value={ellyPrompt}
            onChange={(e) => {
              setEllyPrompt(e.target.value);
              setEllyError(null);
            }}
            disabled={ellyLoading || !!pendingMutation}
            placeholder={pendingMutation ? "Review the proposed change above…" : "Ask Elly to edit this document…"}
            className="flex-1 bg-transparent text-[11px] outline-none placeholder:text-[color:var(--text-tertiary)] disabled:opacity-40"
            style={{ color: "var(--text-primary)" }}
          />
          {ellyLoading ? (
            <button
              type="button"
              onClick={() => { abortRef.current?.abort(); setEllyLoading(false); }}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] transition hover:bg-red-500/20"
              style={{ color: "var(--text-tertiary)" }}
            >
              <Loader2 size={10} className="animate-spin" />
              Cancel
            </button>
          ) : (
            <button
              type="submit"
              disabled={!ellyPrompt.trim() || !!pendingMutation}
              className="rounded-lg px-2.5 py-1 text-[10px] font-medium transition disabled:opacity-30 hover:opacity-90"
              style={{ background: "var(--os-accent)", color: "#fff" }}
            >
              Ask
            </button>
          )}
        </form>
        {ellyError && (
          <p className="border-t px-4 py-1.5 text-[10px]" style={{ borderColor: "var(--os-border-faint)", color: "rgba(239,68,68,0.9)" }}>
            {ellyError}
          </p>
        )}
      </div>

      {/* ─── Properties panel ────────────────────────────────── */}
      {showProperties && (
        <aside
          className="flex w-56 flex-shrink-0 flex-col gap-4 border-l overflow-y-auto p-4"
          style={{ borderColor: "var(--os-border-faint)", background: "var(--bg-elevated)" }}
        >
          <div>
            <p className="mb-2 text-[9px] uppercase tracking-[0.14em]" style={{ color: "var(--text-tertiary)" }}>
              Properties
            </p>

            {/* Owner */}
            <div className="mb-3">
              <p className="mb-0.5 text-[10px]" style={{ color: "var(--text-tertiary)" }}>Owner</p>
              <div className="flex items-center gap-2">
                <div
                  className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-black"
                  style={{ background: "var(--os-accent)" }}
                >
                  {selected.owner[0]}
                </div>
                <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{selected.owner}</span>
              </div>
            </div>

            {/* Tag selector */}
            <div className="mb-3">
              <p className="mb-1 text-[10px]" style={{ color: "var(--text-tertiary)" }}>Tag</p>
              <div className="flex flex-wrap gap-1">
                {(Object.keys(TAG_COLORS) as DocTag[]).map((t) => {
                  const tc = TAG_COLORS[t];
                  const isActive = selected.tag === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => updateDoc(selected.id, { tag: t })}
                      className="rounded-full px-2 py-0.5 text-[9px] font-medium transition hover:opacity-80"
                      style={{
                        background: isActive ? tc.bg : "rgba(255,255,255,0.06)",
                        color: isActive ? tc.text : "var(--text-tertiary)",
                        border: isActive ? `1px solid ${tc.text}50` : "1px solid transparent",
                      }}
                    >
                      {tc.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Stats */}
            <div className="mb-3 space-y-1.5">
              <div className="flex justify-between text-[10px]">
                <span style={{ color: "var(--text-tertiary)" }}>Words</span>
                <span style={{ color: "var(--text-secondary)" }}>{selected.wordCount ?? 0}</span>
              </div>
              <div className="flex justify-between text-[10px]">
                <span style={{ color: "var(--text-tertiary)" }}>Characters</span>
                <span style={{ color: "var(--text-secondary)" }}>{selected.body.length}</span>
              </div>
              <div className="flex justify-between text-[10px]">
                <span style={{ color: "var(--text-tertiary)" }}>Last updated</span>
                <span style={{ color: "var(--text-secondary)" }}>{selected.updatedAt}</span>
              </div>
            </div>

            {/* Share button (visual only) */}
            <button
              type="button"
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2 text-[11px] transition hover:bg-white/10"
              style={{ borderColor: "var(--os-border-faint)", color: "var(--text-secondary)" }}
            >
              <Share2 size={11} />
              Share document
            </button>
          </div>
        </aside>
      )}
    </div>
  );
}
