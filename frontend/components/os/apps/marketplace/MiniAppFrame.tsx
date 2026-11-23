"use client";

/**
 * Runs a mini-app in a locked-down iframe:
 *  - sandbox without allow-same-origin → own opaque origin, no access to Elyra's cookies, storage or DOM
 *  - CSP default-src 'none' → no network at all (no fetch, no external scripts or images)
 *  - the only way out is a small postMessage bridge: elyra.get / elyra.set / elyra.ask
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { KIT_CSS, KIT_JS } from "@/lib/marketplace/kit";

const BRIDGE = `(function(){var seq=0,pending={};
window.addEventListener('message',function(e){var m=e.data;if(!m||m.__elyra!==1||!pending[m.id])return;var p=pending[m.id];delete pending[m.id];if(m.error)p.reject(new Error(m.error));else p.resolve(m.result);});
function call(method,args){return new Promise(function(resolve,reject){var id=++seq;pending[id]={resolve:resolve,reject:reject};parent.postMessage({__elyra:1,id:id,method:method,args:args},'*');});}
window.elyra={get:function(k){return call('get',[String(k)]);},set:function(k,v){return call('set',[String(k),v]);},ask:function(p){return call('ask',[String(p)]);}};
window.addEventListener('error',function(e){parent.postMessage({__elyra:1,method:'error',args:[String(e.message||e)]},'*');});
window.addEventListener('unhandledrejection',function(e){parent.postMessage({__elyra:1,method:'error',args:[String((e.reason&&e.reason.message)||e.reason)]},'*');});
document.addEventListener('submit',function(e){e.preventDefault();},true);})();`;

function themeVars(): string {
  if (typeof window === "undefined") return "";
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const dark = document.documentElement.classList.contains("dark");
  // !important: generated apps sometimes redefine these variables – Elyra's theme must win.
  const vars: Array<[string, string]> = [
    ["--bg", v("--bg-canvas", dark ? "#0f1120" : "#f7f8fb")],
    ["--surface", v("--bg-surface", dark ? "#171a2e" : "#ffffff")],
    ["--text", v("--text-primary", dark ? "#eef0f8" : "#14161f")],
    ["--muted", v("--text-secondary", dark ? "#9aa0b8" : "#5b6275")],
    ["--accent", v("--os-accent", "#6c9cfc")],
    ["--border", v("--os-border-soft", dark ? "rgba(255,255,255,.12)" : "rgba(0,0,0,.1)")],
  ];
  return `:root{${vars.map(([k, val]) => `${k}:${val} !important;`).join("")}color-scheme:${dark ? "dark" : "light"};}`;
}

export function buildSrcDoc(bodyHtml: string): string {
  const dark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  return `<!doctype html><html lang="de" data-theme="${dark ? "dark" : "light"}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>${themeVars()}
*{box-sizing:border-box}html,body{margin:0;min-height:100%}body{background:var(--bg);color:var(--text);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif}
button,input,select,textarea{font:inherit;color:inherit}</style>
<style>${KIT_CSS}</style>
<script>${BRIDGE}</script>
<script>${KIT_JS}</script></head><body>${bodyHtml}</body></html>`;
}

type Props = {
  html: string;
  /** Persistent data of the app (key → value). */
  initialData?: Record<string, unknown>;
  onDataChange?: (data: Record<string, unknown>) => void;
  onAsk: (prompt: string) => Promise<string>;
  /** Called with the first runtime/syntax error of the app (e.g. to offer an automatic fix). */
  onError?: (message: string) => void;
  /** Rendered next to the error notice. */
  errorAction?: React.ReactNode;
  className?: string;
};

export default function MiniAppFrame({ html, initialData, onDataChange, onAsk, onError, errorAction, className }: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const dataRef = useRef<Record<string, unknown>>({ ...(initialData ?? {}) });
  const [error, setError] = useState<string | null>(null);
  const srcDoc = useMemo(() => buildSrcDoc(html), [html]);

  useEffect(() => { dataRef.current = { ...(initialData ?? {}) }; setError(null); }, [html, initialData]);

  useEffect(() => {
    const onMessage = async (event: MessageEvent) => {
      const frame = frameRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      const msg = event.data as { __elyra?: number; id?: number; method?: string; args?: unknown[] } | null;
      if (!msg || msg.__elyra !== 1) return;
      if (msg.method === "error") {
        const text = String(msg.args?.[0] ?? "Fehler in der Mini-App");
        setError((prev) => prev ?? text);
        onError?.(text);
        return;
      }
      const reply = (payload: { result?: unknown; error?: string }) =>
        frame.contentWindow?.postMessage({ __elyra: 1, id: msg.id, ...payload }, "*");
      try {
        if (msg.method === "get") {
          reply({ result: dataRef.current[String(msg.args?.[0])] ?? null });
        } else if (msg.method === "set") {
          const key = String(msg.args?.[0]);
          const value = JSON.parse(JSON.stringify(msg.args?.[1] ?? null)) as unknown;
          dataRef.current = { ...dataRef.current, [key]: value };
          onDataChange?.(dataRef.current);
          reply({ result: true });
        } else if (msg.method === "ask") {
          reply({ result: await onAsk(String(msg.args?.[0] ?? "")) });
        } else {
          reply({ error: "Unbekannte Funktion" });
        }
      } catch (err) {
        reply({ error: err instanceof Error ? err.message : "Fehler" });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onAsk, onDataChange, onError]);

  return (
    <div className={`relative flex min-h-0 flex-1 flex-col ${className ?? ""}`}>
      <iframe
        ref={frameRef}
        title="Mini-App"
        sandbox="allow-scripts allow-forms"
        srcDoc={srcDoc}
        className="min-h-0 w-full flex-1 rounded-xl border-0"
        style={{ background: "var(--bg-canvas)" }}
      />
      {error ? (
        <div className="absolute bottom-2 left-2 right-2 flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[11px] text-amber-300" style={{ borderColor: "rgba(245,158,11,0.4)", background: "rgba(0,0,0,0.7)" }}>
          <span className="min-w-0 flex-1">Fehler in der Mini-App: {error}</span>
          {errorAction}
        </div>
      ) : null}
    </div>
  );
}
