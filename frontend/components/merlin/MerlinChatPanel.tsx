"use client";

import { useEffect, useRef, useState } from "react";
import { buildAssistantEndpoint } from "@utils/auth-guard";
import { useWorkspaceData } from "@/components/workspace/WorkspaceContext";
import { useLocale } from "@/components/providers/LocaleProvider";
import { useT } from "@/lib/i18n/useT";

type MerlinSystemEvent = "sending" | "receiving" | "error";
type MerlinSystemEventPayload = {
  detail?: string;
};

type ChatMessage = {
  id: number;
  author: "Merlin" | "You";
  text: string;
  variant?: "error";
};

type MerlinChatPanelProps = {
  className?: string;
  compact?: boolean;
  onClose?: () => void;
  onSystemEvent?: (event: MerlinSystemEvent, payload?: MerlinSystemEventPayload) => void;
  onUserActivity?: (status?: "focus" | "thinking") => void;
};

const CHAT_ENDPOINT = buildAssistantEndpoint("/v1/runs");

const parseReply = (payload: any): string | null => {
  if (typeof payload?.reply === "string") {
    return payload.reply;
  }
  if (Array.isArray(payload?.choices) && typeof payload.choices[0]?.message?.content === "string") {
    return payload.choices[0].message.content;
  }
  if (typeof payload?.choices?.[0]?.text === "string") {
    return payload.choices[0].text;
  }
  if (typeof payload?.choices === "string") {
    return payload.choices;
  }
  return null;
};

export default function MerlinChatPanel({
  className = "",
  compact = false,
  onClose,
  onSystemEvent,
  onUserActivity,
}: MerlinChatPanelProps) {
  const { data } = useWorkspaceData();
  const workspaceId = data?.activeWorkspace?.id ?? null;
  const t = useT();
  const { resolvedLanguage } = useLocale();
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: 1, author: "Merlin", text: t("merlin.chat_ready") },
  ]);
  const [inputValue, setInputValue] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!listRef.current) {
      return;
    }
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages]);

  const handleSend = async () => {
    const trimmed = inputValue.trim();
    if (!trimmed) {
      return;
    }

    const messageId = Date.now();
    setMessages((prev) => [
      ...prev,
      {
        id: messageId,
        author: "You",
        text: trimmed,
      },
    ]);
    setInputValue("");
    setIsTyping(true);
        onSystemEvent?.("sending", { detail: trimmed });
        onUserActivity?.("focus");

    try {
    const requestPayload: Record<string, unknown> = { prompt: trimmed, language: resolvedLanguage };
      if (workspaceId) {
        requestPayload.workspaceId = workspaceId;
      }
      const response = await fetch(CHAT_ENDPOINT, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestPayload),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(body || `Status ${response.status}`);
      }

      const responseBody = await response.json();
      const runId = responseBody?.run?.id ?? null;
      const runStatus = responseBody?.run?.status ?? "queued";
      const reply = parseReply(responseBody);
      const finalReply = (reply?.trim() || `Run ${runStatus}${runId ? ` · ${runId}` : ""}`).trim();
      setMessages((prev) => [
        ...prev,
        {
          id: messageId + 1,
          author: "Merlin",
          text: finalReply,
        },
      ]);
      onSystemEvent?.("receiving", { detail: finalReply });
    } catch (error) {
      const fallbackMessage =
        error instanceof Error ? error.message : t("merlin.chat_reply_missing");
      const formattedError = `${t("merlin.chat_error_prefix")} ${fallbackMessage}`;
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now(),
          author: "Merlin",
          text: formattedError,
          variant: "error",
        },
      ]);
      onSystemEvent?.("error", { detail: fallbackMessage });
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div
      className={`flex h-full max-h-[560px] flex-col gap-3 rounded-3xl border border-white/10 bg-slate-950/80 p-5 shadow-[0_20px_60px_rgba(2,6,23,0.7)] ${
        compact ? "max-h-[420px]" : ""
      } ${className}`}
    >
      <div className="flex items-center justify-between">
      <div>
        <p className="text-xs uppercase tracking-[0.4em] text-slate-400">{t("merlin.chat_title")}</p>
        <p className="text-sm text-slate-200">{t("merlin.chat_subtitle")}</p>
      </div>
        {onClose && (
        <button
          onClick={onClose}
          className="rounded-full border border-white/10 px-3 py-1 text-xs font-semibold text-slate-200 transition hover:border-white/30"
        >
          {t("merlin.chat_close")}
        </button>
        )}
      </div>

      <div
        ref={listRef}
        className="flex-1 overflow-y-auto space-y-3 rounded-2xl border border-white/5 bg-slate-950/50 p-3 text-sm text-slate-100"
      >
        {messages.map((message) => (
          <div key={message.id} className="space-y-1">
            <p className="text-xs uppercase tracking-[0.4em] text-slate-400">{message.author}</p>
            <p
              className={`text-sm leading-relaxed ${message.variant === "error" ? "text-rose-300" : "text-slate-200"}`}
            >
              {message.text}
            </p>
          </div>
        ))}
        {isTyping && <p className="text-xs italic text-slate-400">{t("merlin.chat_status_typing")}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <textarea
          value={inputValue}
          onChange={(event) => {
            setInputValue(event.target.value);
            onUserActivity?.("thinking");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              handleSend();
            }
          }}
          rows={compact ? 2 : 3}
          placeholder={t("merlin.chat_placeholder")}
          className="min-h-[70px] resize-none rounded-2xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none"
        />
        <div className="flex items-center justify-between text-xs text-slate-400">
            <span>
              {isTyping ? t("merlin.chat_status_typing") : t("merlin.chat_status_waiting")}
            </span>
            <button
              onClick={handleSend}
              className="rounded-2xl bg-gradient-to-r from-cyan-400 to-indigo-500 px-4 py-1.5 text-sm font-semibold text-slate-950 transition hover:brightness-110"
            >
              {t("merlin.chat_send")}
            </button>
        </div>
      </div>
    </div>
  );
}
