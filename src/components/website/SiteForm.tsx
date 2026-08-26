"use client";

/**
 * Public-facing form.
 *
 * Submits through the submit_website_form() RPC rather than inserting into
 * website_submissions directly: the function pins the row to the tenant that
 * owns the site, validates the email, and rate-limits by address. A visitor
 * cannot redirect an enquiry to a different school by editing the payload.
 */

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { PublicForm, FormField } from "@/lib/website/types";

export function SiteForm({
  form, websiteId, sourcePage, variant = "stacked", submitLabel,
}: {
  form: PublicForm;
  websiteId: string;
  sourcePage?: string;
  /** "inline" renders a single-row email capture, used by the newsletter band. */
  variant?: "stacked" | "inline";
  submitLabel?: string;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState<string>("");
  /* Bots fill hidden fields; humans do not. */
  const [honeypot, setHoneypot] = useState("");

  const fields: FormField[] = Array.isArray(form.fields) ? form.fields : [];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (honeypot) return;                      // silently drop
    setState("sending");
    setMessage("");

    const supabase = createClient();
    const { data, error } = await supabase.rpc("submit_website_form", {
      p_website_id: websiteId,
      p_form_key: form.key,
      p_data: values,
      p_source_page: sourcePage ?? null,
    });

    if (error) {
      setState("error");
      setMessage("Something went wrong sending your message. Please try again.");
      return;
    }

    const result = data as { ok?: boolean; error?: string; message?: string } | null;
    if (result?.ok) {
      setState("sent");
      setMessage(result.message ?? "Thank you. We will be in touch shortly.");
      setValues({});
    } else {
      setState("error");
      setMessage(result?.error ?? "Your message could not be sent.");
    }
  }

  if (state === "sent") {
    return (
      <div
        role="status"
        className={variant === "inline" ? "text-center" : "rounded-[var(--r-md)] p-6 text-center"}
        style={variant === "inline"
          ? { color: "inherit" }
          : { background: "var(--c-surface-alt)", color: "var(--c-text)" }}
      >
        <p className="font-semibold">{message}</p>
      </div>
    );
  }

  /* Inline variant: a single row, used inside the newsletter band where the
     surrounding surface is already dark and the label is implied. */
  if (variant === "inline") {
    const emailField = fields.find(f => f.type === "email") ?? fields[0];
    if (!emailField) return null;
    const id = `${form.key}-${emailField.name}`;
    return (
      <form onSubmit={submit} className="newsletter-form">
        <label htmlFor={id} className="sr-only">{emailField.label}</label>
        <input
          id={id}
          name={emailField.name}
          type={emailField.type || "email"}
          required
          placeholder={emailField.placeholder ?? emailField.label}
          value={values[emailField.name] ?? ""}
          onChange={e => setValues(v => ({ ...v, [emailField.name]: e.target.value }))}
        />
        {/* Honeypot */}
        <div aria-hidden="true" className="absolute -left-[9999px] w-px h-px overflow-hidden">
          <label htmlFor={`${form.key}-company-inline`}>Company</label>
          <input id={`${form.key}-company-inline`} tabIndex={-1} autoComplete="off"
            value={honeypot} onChange={e => setHoneypot(e.target.value)} />
        </div>
        <button type="submit" disabled={state === "sending"} className="btn btn-gold">
          {state === "sending" ? "Sending…" : (submitLabel ?? "Subscribe")}
        </button>
        {state === "error" && (
          <p role="alert" className="w-full text-sm font-medium" style={{ color: "var(--c-error)" }}>
            {message}
          </p>
        )}
      </form>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {fields.map((f) => {
        const id = `${form.key}-${f.name}`;
        const common = {
          id,
          name: f.name,
          required: f.required ?? false,
          value: values[f.name] ?? "",
          "aria-describedby": f.help ? `${id}-help` : undefined,
          onChange: (
            e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
          ) => setValues((v) => ({ ...v, [f.name]: e.target.value })),
          className:
            "w-full px-3 py-2.5 text-sm rounded-[var(--r-sm)] border outline-none " +
            "focus:ring-2 focus:ring-offset-0",
          style: {
            borderColor: "var(--c-border)",
            background: "var(--c-background)",
            color: "var(--c-text)",
          } as React.CSSProperties,
        };

        return (
          <div key={f.name} className="space-y-1">
            <label htmlFor={id} className="block text-sm font-medium" style={{ color: "var(--c-text)" }}>
              {f.label}
              {f.required && <span aria-hidden="true" style={{ color: "var(--c-error)" }}> *</span>}
              {f.required && <span className="sr-only"> (required)</span>}
            </label>

            {f.type === "textarea" ? (
              <textarea {...common} rows={5} placeholder={f.placeholder} />
            ) : f.type === "select" ? (
              <select {...common}>
                <option value="">Please choose…</option>
                {(f.options ?? []).map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            ) : (
              <input {...common} type={f.type || "text"} placeholder={f.placeholder} />
            )}

            {f.help && (
              <p id={`${id}-help`} className="text-xs" style={{ color: "var(--c-text-muted)" }}>
                {f.help}
              </p>
            )}
          </div>
        );
      })}

      {/* Honeypot: visually hidden and hidden from assistive tech. */}
      <div aria-hidden="true" className="absolute -left-[9999px] w-px h-px overflow-hidden">
        <label htmlFor={`${form.key}-company`}>Company</label>
        <input
          id={`${form.key}-company`}
          tabIndex={-1}
          autoComplete="off"
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
        />
      </div>

      {state === "error" && (
        <p role="alert" className="text-sm font-medium" style={{ color: "var(--c-error)" }}>
          {message}
        </p>
      )}

      <button
        type="submit"
        disabled={state === "sending"}
        className="inline-flex items-center justify-center px-6 py-3 text-sm transition-opacity disabled:opacity-60"
        style={{
          background: "var(--c-primary)",
          color: "#fff",
          borderRadius: "var(--btn-radius)",
          fontWeight: "var(--btn-weight)" as unknown as number,
          textTransform: "var(--btn-transform)" as React.CSSProperties["textTransform"],
        }}
      >
        {state === "sending" ? "Sending…" : "Send message"}
      </button>
    </form>
  );
}
