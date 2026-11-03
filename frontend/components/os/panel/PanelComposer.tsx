"use client";

type PanelComposerProps = {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  loading?: boolean;
  placeholder?: string;
};

export default function PanelComposer({
  value,
  onChange,
  onSend,
  loading = false,
  placeholder = "Ask Elli...",
}: PanelComposerProps) {
  return (
    <div className="flex gap-2">
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          onSend();
        }}
        placeholder={placeholder}
        className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-[14px] text-[var(--text)] placeholder:text-[var(--muted)] outline-none focus:border-[var(--accent)]"
      />
      <button
        type="button"
        onClick={onSend}
        disabled={loading}
        className="inline-flex items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--panel2)] px-3 py-2 text-[12px] font-semibold text-[var(--text-secondary)] disabled:opacity-40"
      >
        {loading ? "Sending..." : "Send"}
      </button>
    </div>
  );
}
