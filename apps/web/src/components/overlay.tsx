"use client";

import { cn } from "@/lib/utils";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

/* ── Modal ─────────────────────────────────────────── */

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop flex items-center justify-center p-4" onClick={onClose}>
      <div
        className={cn(
          "modal-panel card max-h-[85vh] w-full overflow-y-auto p-6",
          wide ? "max-w-3xl" : "max-w-lg"
        )}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted transition hover:bg-white/5 hover:text-foreground"
            aria-label="Close"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ── Toast ─────────────────────────────────────────── */

type Toast = { id: number; message: string; type: "success" | "error" | "info" };

const ToastContext = createContext<{ toast: (msg: string, type?: Toast["type"]) => void }>({
  toast: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, type: Toast["type"] = "success") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed bottom-6 left-1/2 z-[60] flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "animate-slide-up pointer-events-auto rounded-xl border px-4 py-3 text-sm font-medium shadow-lg backdrop-blur",
              t.type === "success" && "border-success/30 bg-success/10 text-success",
              t.type === "error" && "border-danger/30 bg-danger/10 text-danger",
              t.type === "info" && "border-accent/30 bg-accent/10 text-accent"
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* ── Skeleton ──────────────────────────────────────── */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} />;
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

/* ── Tabs ──────────────────────────────────────────── */

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: string; label: string }[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-xl border border-card-border bg-card p-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            "whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200",
            active === t.id
              ? "bg-primary/20 text-foreground shadow-[inset_0_0_16px_rgba(160,32,240,0.15)]"
              : "text-muted hover:text-foreground"
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* ── Progress ──────────────────────────────────────── */

export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="progress-bar">
      <div style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

/* ── Empty state ───────────────────────────────────── */

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="animate-fade-in flex flex-col items-center gap-2 py-14 text-center">
      <div className="animate-float text-4xl opacity-40">◇</div>
      <p className="font-medium text-muted">{title}</p>
      {hint && <p className="text-sm text-muted/70">{hint}</p>}
    </div>
  );
}
