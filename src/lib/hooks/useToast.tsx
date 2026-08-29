"use client";

/**
 * Lightweight toast hook.
 *
 * Gives any client page a consistent way to surface success/error
 * feedback for mutations, replacing silent failures and ad-hoc
 * `alert()` calls. Usage:
 *
 *   const { notify, ToastHost } = useToast();
 *   ...
 *   const { error } = await supabase.from("x").update(...).eq(...);
 *   if (error) { notify(error.message, "error"); return; }
 *   notify("Saved");
 *   ...
 *   return (<div>... <ToastHost /></div>);
 *
 * Toasts auto-dismiss after 3.5s (errors linger a little longer) and
 * stack. No external dependency.
 */

import { useCallback, useState } from "react";

type ToastKind = "success" | "error" | "info";
interface ToastItem { id: number; message: string; kind: ToastKind; }

let _seq = 0;

export function useToast() {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback((message: string, kind: ToastKind = "success") => {
    const id = ++_seq;
    setItems((prev) => [...prev, { id, message, kind }]);
    const ttl = kind === "error" ? 6000 : 3500;
    window.setTimeout(() => dismiss(id), ttl);
    return id;
  }, [dismiss]);

  const ToastHost = useCallback(() => {
    if (items.length === 0) return null;
    return (
      <div
        aria-live="polite"
        style={{
          position: "fixed",
          bottom: 24,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 200,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          alignItems: "center",
          pointerEvents: "none",
        }}
      >
        {items.map((t) => (
          <button
            key={t.id}
            onClick={() => dismiss(t.id)}
            style={{
              pointerEvents: "auto",
              cursor: "pointer",
              border: "none",
              maxWidth: 440,
              textAlign: "left",
              padding: "11px 18px",
              borderRadius: 999,
              fontSize: 13,
              fontWeight: 600,
              color: "#fff",
              boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
              background:
                t.kind === "error" ? "#dc2626" : t.kind === "info" ? "#0F2A47" : "#16a34a",
            }}
          >
            {t.message}
          </button>
        ))}
      </div>
    );
  }, [items, dismiss]);

  return { notify, ToastHost };
}
