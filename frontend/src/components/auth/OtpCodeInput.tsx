"use client";

import { ClipboardEvent, KeyboardEvent, useRef } from "react";

export const OTP_LENGTH = 6;

type OtpCodeInputProps = {
  value: string;
  onChange: (value: string) => void;
  /** Fired once the sixth digit lands, so the user never hunts for a button. */
  onComplete?: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  /** Announced to screen readers in place of a visible label on each box. */
  label: string;
};

/**
 * Six single-character boxes backed by one dense string.
 *
 * Keeping the value dense- never a sparse array with holes- is what makes the
 * keyboard behaviour predictable: box `i` always shows `value[i]`, so backspace,
 * arrows and a pasted code all reduce to plain string edits.
 */
export function OtpCodeInput({ value, onChange, onComplete, disabled, invalid, label }: OtpCodeInputProps) {
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  const commit = (next: string) => {
    const trimmed = next.slice(0, OTP_LENGTH);
    onChange(trimmed);
    if (trimmed.length === OTP_LENGTH) onComplete?.(trimmed);
  };

  const focusAt = (index: number) => {
    const target = inputsRef.current[Math.min(Math.max(index, 0), OTP_LENGTH - 1)];
    target?.focus();
    target?.select();
  };

  const handleChange = (index: number, raw: string) => {
    const digits = raw.replace(/\D/g, "");
    if (!digits) return;

    // Slicing from `index` overwrites this box and any boxes a multi-digit entry
    // spills into, rather than inserting and pushing digits off the end.
    commit(value.slice(0, index) + digits + value.slice(index + digits.length));
    focusAt(index + digits.length);
  };

  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace") {
      event.preventDefault();
      // Backspace in an empty box reaches back and clears the previous one,
      // which is what people expect after typing past a mistake.
      const target = value[index] ? index : index - 1;
      if (target < 0) return;

      commit(value.slice(0, target) + value.slice(target + 1));
      focusAt(target);
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusAt(index - 1);
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      focusAt(index + 1);
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const digits = event.clipboardData.getData("text").replace(/\D/g, "");
    if (!digits) return;

    // Codes get pasted straight out of the email, often with stray whitespace or
    // the surrounding sentence attached.
    event.preventDefault();
    commit(digits);
    focusAt(digits.length);
  };

  return (
    <div className="grid grid-cols-6 gap-2">
      {Array.from({ length: OTP_LENGTH }, (_, index) => (
        <input
          key={index}
          ref={(element) => {
            inputsRef.current[index] = element;
          }}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-label={`${label}, digit ${index + 1} of ${OTP_LENGTH}`}
          aria-invalid={invalid || undefined}
          // Not `maxLength={1}`: a paste or an autofilled code must be allowed to
          // land in a single box before it is spread across the rest.
          value={value[index] ?? ""}
          disabled={disabled}
          onChange={(event) => handleChange(index, event.target.value)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onPaste={handlePaste}
          onFocus={(event) => event.target.select()}
          className={`h-12 w-full rounded-xl border bg-white text-center text-lg font-semibold text-slate-900 tabular-nums outline-none transition focus:border-[#0D1282] focus:ring-4 focus:ring-[#0D1282]/10 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 ${
            invalid ? "border-[#D81F26]" : "border-slate-300"
          }`}
        />
      ))}
    </div>
  );
}
