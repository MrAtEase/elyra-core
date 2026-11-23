"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type ElliMode = "assistant" | "mentor" | "planner" | "operator" | "instructor";

type ElliMessage = {
  id: string;
  role: "user" | "elli";
  text: string;
};

type ElliContextValue = {
  mode: ElliMode;
  setMode: (mode: ElliMode) => void;
  messages: ElliMessage[];
  appendMessage: (message: Omit<ElliMessage, "id">) => void;
  clearMessages: () => void;
};

const ElliContext = createContext<ElliContextValue | null>(null);

function createMessageId() {
  return `elli_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function ElliProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ElliMode>("assistant");
  const [messages, setMessages] = useState<ElliMessage[]>([]);

  const appendMessage = useCallback((message: Omit<ElliMessage, "id">) => {
    setMessages((prev) => [...prev, { ...message, id: createMessageId() }]);
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setMode("assistant");
  }, []);

  const value = useMemo(
    () => ({ mode, setMode, messages, appendMessage, clearMessages }),
    [mode, messages, appendMessage, clearMessages]
  );

  return <ElliContext.Provider value={value}>{children}</ElliContext.Provider>;
}

export function useElli() {
  const value = useContext(ElliContext);
  if (!value) {
    throw new Error("useElli must be used inside ElliProvider");
  }
  return value;
}
