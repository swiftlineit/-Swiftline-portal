"use client";

import { useEffect, useRef, useState } from "react";
import { FiX } from "react-icons/fi";

/**
 * The dialog behind every claim action that needs input.
 *
 * Replaces `window.prompt`, which cannot be styled, cannot validate before it
 * closes, cannot offer a list to choose from, and looks like a browser warning
 * rather than part of the portal. It also loses whatever was typed the moment it
 * is dismissed, which is the worst property for a field that requires a reason.
 */

export type DialogField =
  | { kind: "text"; name: string; label: string; placeholder?: string; required?: boolean }
  | { kind: "textarea"; name: string; label: string; placeholder?: string; required?: boolean }
  | {
      kind: "select";
      name: string;
      label: string;
      required?: boolean;
      options: Array<{ value: string; label: string }>;
    };

export default function ClaimActionDialog({
  open,
  title,
  description,
  fields,
  confirmLabel = "Confirm",
  tone = "primary",
  busy = false,
  onConfirm,
  onClose
}: {
  open: boolean;
  title: string;
  description?: string;
  fields: DialogField[];
  confirmLabel?: string;
  tone?: "primary" | "danger";
  busy?: boolean;
  onConfirm: (values: Record<string, string>) => void;
  onClose: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const firstField = useRef<HTMLElement | null>(null);

  // Cleared on open rather than on close, so a failed action can reopen with the
  // dialog fresh while a cancelled one leaves nothing behind.
  useEffect(() => {
    if (!open) return;
    // Deferred off the effect body, matching the other client components: a
    // synchronous set here cascades a render every time the dialog opens.
    void Promise.resolve().then(() => {
      setValues(
        Object.fromEntries(
          fields.map((field) => [
            field.name,
            field.kind === "select" ? (field.options[0]?.value ?? "") : ""
          ])
        )
      );
      setTouched({});
    });
  }, [open, fields]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const missing = (field: DialogField) => field.required !== false && !values[field.name]?.trim();
  const canConfirm = fields.every((field) => !missing(field));

  function confirm() {
    // Marks everything touched so unfilled fields light up together, rather than
    // one at a time as the user discovers them.
    if (!canConfirm) {
      setTouched(Object.fromEntries(fields.map((field) => [field.name, true])));
      return;
    }
    onConfirm(values);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => {
        // Only a click on the backdrop itself closes; dragging out of a textarea
        // should not throw away what was typed.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-xl">
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">{title}</h2>
            {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <FiX />
          </button>
        </header>

        <div className="space-y-4 px-5 py-4">
          {fields.map((field, index) => {
            const invalid = touched[field.name] && missing(field);
            const border = invalid ? "border-red-400 bg-red-50" : "border-slate-300";

            return (
              <label key={field.name} className="block">
                <span className="text-sm font-semibold text-slate-700">
                  {field.label}
                  {field.required !== false ? <span className="ml-1 text-red-600">*</span> : null}
                </span>

                {field.kind === "select" ? (
                  <select
                    value={values[field.name] ?? ""}
                    onChange={(event) =>
                      setValues((current) => ({ ...current, [field.name]: event.target.value }))
                    }
                    className={`mt-1 w-full rounded-xl border px-4 py-2.5 text-sm ${border}`}
                  >
                    {field.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : field.kind === "textarea" ? (
                  <textarea
                    ref={index === 0 ? (firstField as React.Ref<HTMLTextAreaElement>) : undefined}
                    autoFocus={index === 0}
                    rows={3}
                    value={values[field.name] ?? ""}
                    placeholder={field.placeholder}
                    onChange={(event) =>
                      setValues((current) => ({ ...current, [field.name]: event.target.value }))
                    }
                    onBlur={() => setTouched((current) => ({ ...current, [field.name]: true }))}
                    className={`mt-1 w-full rounded-xl border px-4 py-2.5 text-sm ${border}`}
                  />
                ) : (
                  <input
                    ref={index === 0 ? (firstField as React.Ref<HTMLInputElement>) : undefined}
                    autoFocus={index === 0}
                    value={values[field.name] ?? ""}
                    placeholder={field.placeholder}
                    onChange={(event) =>
                      setValues((current) => ({ ...current, [field.name]: event.target.value }))
                    }
                    onBlur={() => setTouched((current) => ({ ...current, [field.name]: true }))}
                    className={`mt-1 w-full rounded-xl border px-4 py-2.5 text-sm ${border}`}
                  />
                )}

                {invalid ? (
                  <span className="mt-1 block text-xs font-medium text-red-600">
                    This is needed before continuing.
                  </span>
                ) : null}
              </label>
            );
          })}
        </div>

        <footer className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={confirm}
            className={`rounded-xl px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40 ${
              tone === "danger" ? "bg-red-700 hover:bg-red-600" : "bg-blue-900 hover:bg-blue-800"
            }`}
          >
            {busy ? "Working..." : confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}
