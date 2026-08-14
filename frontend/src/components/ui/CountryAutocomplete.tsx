"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import CountryFlag from "@/components/CountryFlag";
import { findCountries, resolveCountry } from "@/lib/countryLookup";

/**
 * A destination country field that takes what a person actually types.
 *
 * The value submitted is an ISO-3166 alpha-2 code, but customers type "UK" or
 * "united kingdom", so the field suggests countries by name, code and everyday
 * abbreviation and shows the flag against each one.
 *
 * Free text is kept rather than rejected. The portal lists a few dozen
 * countries; the rate cards and route records behind this field do not, so a
 * code outside that list is passed through for the database to answer. The
 * field guides, it does not gatekeep.
 *
 * Controlled on the visible text alone, with the code derived from it by
 * `toCountryCode`. Holding text and code as two pieces of state is what makes
 * this kind of field drift, where the box says one country and the search runs
 * on another.
 */
export default function CountryAutocomplete({
  label,
  value,
  onChange,
  placeholder,
  disabled = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const inputId = useId();
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);

  const suggestions = useMemo(() => findCountries(value).slice(0, 8), [value]);
  const selected = useMemo(() => resolveCountry(value), [value]);

  // Clamped while rendering rather than reset from an effect: the list shrinks
  // as the query narrows, and an index left pointing past the end would make
  // Enter select nothing or the wrong row.
  const activeIndex = Math.min(highlighted, Math.max(suggestions.length - 1, 0));

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  function select(name: string) {
    onChange(name);
    setOpen(false);
    setHighlighted(0);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setHighlighted(Math.min(activeIndex + 1, suggestions.length - 1));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted(Math.max(activeIndex - 1, 0));
      return;
    }

    // Enter takes the highlighted suggestion only while the list is open, so it
    // cannot overwrite a code somebody deliberately typed for a country the
    // portal does not list.
    if (event.key === "Enter" && open && suggestions[activeIndex]) {
      event.preventDefault();
      select(suggestions[activeIndex].name);
    }
  }

  return (
    <div ref={containerRef} className="relative block min-w-0">
      {/* The text sits in a span inside a block label, matching the plain
          fields this sits beside. Putting the small type on the label itself
          shortens its line box and lifts the whole field out of alignment. */}
      <label htmlFor={inputId} className="block">
        <span className="text-xs font-semibold uppercase text-slate-600">{label}</span>
      </label>

      <div className="relative mt-2">
        {/* The flag sits inside the box so the confirmation of what was
            understood is on the field itself, not somewhere alongside it. */}
        {selected ? (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2">
            <CountryFlag code={selected.iso2} />
          </span>
        ) : null}

        <input
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={open && suggestions[activeIndex] ? `${listboxId}-${activeIndex}` : undefined}
          autoComplete="off"
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
            setHighlighted(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          className={`h-11 w-full rounded-xl border border-slate-300 text-sm outline-none focus:border-blue-900 disabled:bg-slate-50 ${selected ? "pl-10" : "pl-3"} ${selected ? "pr-14" : "pr-3"}`}
        />

        {selected ? (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold tracking-wide text-slate-600">
            {selected.iso2.toUpperCase()}
          </span>
        ) : null}
      </div>

      {open && suggestions.length ? (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
        >
          {suggestions.map((country, index) => (
            <li key={country.iso2} id={`${listboxId}-${index}`} role="option" aria-selected={index === activeIndex}>
              <button
                type="button"
                // Pointer-down rather than click: the input's blur would
                // otherwise close the list before the click landed.
                onMouseDown={(event) => {
                  event.preventDefault();
                  select(country.name);
                }}
                onMouseEnter={() => setHighlighted(index)}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm ${index === activeIndex ? "bg-slate-100" : ""}`}
              >
                <CountryFlag code={country.iso2} />
                <span className="min-w-0 flex-1 truncate text-slate-800">{country.name}</span>
                <span className="shrink-0 text-xs font-bold tracking-wide text-slate-500">
                  {country.iso2.toUpperCase()}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
