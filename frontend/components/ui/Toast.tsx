import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type ToastKind = "info" | "success" | "warning";

type ToastProps = HTMLAttributes<HTMLDivElement> & {
  kind?: ToastKind;
};

export function Toast({ className, kind = "info", ...props }: ToastProps) {
  return <div className={cn("uiToast", `uiToast--${kind}`, className)} role="status" aria-live="polite" {...props} />;
}
