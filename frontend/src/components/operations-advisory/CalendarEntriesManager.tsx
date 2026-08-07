"use client";

import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { FiEdit3, FiPlus, FiSave, FiTrash2, FiChevronDown } from "react-icons/fi";
import { listBranches, type Branch } from "@/lib/branches";
import {
  calendarCategories,
  calendarCategoryLabels,
  createCalendarEntry,
  deleteCalendarEntry,
  listCalendarEntries,
  updateCalendarEntry,
  type CalendarCategory,
  type CalendarEntry,
  type CalendarEntryInput
} from "@/lib/operationsAdvisory";

/**
 * The Holiday & Cut-Off Calendar tab. A category selector reveals only the
 * fields that category uses, so a destination holiday never asks for a cut-off
 * time and a flight closing time never asks for a branch.
 */

type FormState = {
  category: CalendarCategory;
  title: string;
  description: string;
  branchId: string;
  countryCode: string;
  locationLabel: string;
  date: string;
  endDate: string;
  time: string;
  weekendDeliveryAvailable: "" | "true" | "false";
  active: boolean;
};

type CategoryFields = {
  showBranch: boolean;
  showCountry: boolean;
  showLocation: boolean;
  showDate: boolean;
  showEndDate: boolean;
  showTime: boolean;
  showWeekend: boolean;
};

const categoryFields: Record<CalendarCategory, CategoryFields> = {
  BRANCH_HOLIDAY: { showBranch: true, showCountry: false, showLocation: false, showDate: true, showEndDate: false, showTime: false, showWeekend: false },
  DESTINATION_HOLIDAY: { showBranch: false, showCountry: true, showLocation: true, showDate: true, showEndDate: false, showTime: false, showWeekend: false },
  CUSTOMS_HOLIDAY: { showBranch: false, showCountry: true, showLocation: false, showDate: true, showEndDate: false, showTime: false, showWeekend: false },
  PICKUP_CUTOFF: { showBranch: true, showCountry: false, showLocation: false, showDate: false, showEndDate: false, showTime: true, showWeekend: false },
  SAME_DAY_BOOKING_CUTOFF: { showBranch: true, showCountry: false, showLocation: false, showDate: false, showEndDate: false, showTime: true, showWeekend: false },
  FLIGHT_CLOSING_TIME: { showBranch: false, showCountry: false, showLocation: true, showDate: false, showEndDate: false, showTime: true, showWeekend: false },
  WEEKEND_DELIVERY: { showBranch: true, showCountry: false, showLocation: false, showDate: false, showEndDate: false, showTime: false, showWeekend: true },
  PEAK_SEASON_RESTRICTION: { showBranch: false, showCountry: false, showLocation: false, showDate: true, showEndDate: true, showTime: false, showWeekend: false }
};

function blankForm(category: CalendarCategory = "BRANCH_HOLIDAY"): FormState {
  return {
    category,
    title: "",
    description: "",
    branchId: "",
    countryCode: "",
    locationLabel: "",
    date: "",
    endDate: "",
    time: "",
    weekendDeliveryAvailable: "",
    active: true
  };
}

/** Entries are stored as UTC midnight so the ISO date part never shifts a day. */
function fromDateInput(value: string) {
  return value ? new Date(`${value}T00:00:00.000Z`).toISOString() : null;
}

function toDateInput(value: string | null) {
  return value ? value.slice(0, 10) : "";
}

function toEntryInput(form: FormState): CalendarEntryInput {
  return {
    category: form.category,
    title: form.title.trim(),
    description: form.description.trim(),
    branchId: form.branchId || null,
    countryCode: form.countryCode.trim().toUpperCase() || null,
    locationLabel: form.locationLabel.trim() || null,
    date: fromDateInput(form.date),
    endDate: fromDateInput(form.endDate),
    time: form.time || null,
    weekendDeliveryAvailable: form.weekendDeliveryAvailable === "" ? null : form.weekendDeliveryAvailable === "true",
    active: form.active
  };
}

function loadEntryIntoForm(entry: CalendarEntry): FormState {
  return {
    category: entry.category,
    title: entry.title,
    description: entry.description,
    branchId: entry.branchId ?? "",
    countryCode: entry.countryCode ?? "",
    locationLabel: entry.locationLabel ?? "",
    date: toDateInput(entry.date),
    endDate: toDateInput(entry.endDate),
    time: entry.time ?? "",
    weekendDeliveryAvailable: entry.weekendDeliveryAvailable === null ? "" : entry.weekendDeliveryAvailable ? "true" : "false",
    active: entry.active
  };
}

export default function CalendarEntriesManager() {
  const [entries, setEntries] = useState<CalendarEntry[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [form, setForm] = useState<FormState>(blankForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;

    async function load() {
      setError("");
      try {
        const [branchData, entryData] = await Promise.all([
          listBranches("", "ACTIVE"),
          listCalendarEntries()
        ]);
        if (!active) return;
        setBranches(branchData.branches);
        setEntries(entryData.entries);
      } catch (caughtError) {
        if (!active) return;
        setError(caughtError instanceof Error ? caughtError.message : "Unable to load calendar entries.");
      }
    }

    void load();
    return () => { active = false; };
  }, []);

  const fields = categoryFields[form.category];

  function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    setMessage("");
  }

  function handleTextChange(field: keyof FormState) {
    return (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      updateField(field, event.target.value as FormState[keyof FormState]);
    };
  }

  function handleCategoryChange(category: CalendarCategory) {
    setEditingId(null);
    setForm({ ...blankForm(category), title: form.title, description: form.description, active: form.active });
    setMessage("");
    setError("");
  }

  function loadEntry(entry: CalendarEntry) {
    setEditingId(entry.id);
    setForm(loadEntryIntoForm(entry));
    setMessage("");
    setError("");
  }

  function resetForm() {
    setEditingId(null);
    setForm(blankForm());
    setMessage("");
    setError("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");

    const payload = toEntryInput(form);

    try {
      if (editingId) {
        await updateCalendarEntry(editingId, payload);
      } else {
        await createCalendarEntry(payload);
      }

      const refreshed = await listCalendarEntries();
      setEntries(refreshed.entries);
      setMessage(editingId ? "Calendar entry updated." : "Calendar entry added.");
      resetForm();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Calendar entry could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(entry: CalendarEntry) {
    if (!window.confirm(`Delete "${entry.title}"? This cannot be undone.`)) return;
    setBusy(true);
    setError("");
    setMessage("");

    try {
      await deleteCalendarEntry(entry.id);
      const refreshed = await listCalendarEntries();
      setEntries(refreshed.entries);
      if (editingId === entry.id) resetForm();
      setMessage("Calendar entry deleted.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Calendar entry could not be deleted.");
    } finally {
      setBusy(false);
    }
  }

  const inputClass = "mt-2 h-10 w-full border rounded-xl border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-blue-900 focus:ring-2 focus:ring-blue-100";
  const labelClass = "text-xs font-semibold uppercase text-slate-500 ";

 return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_440px]">
      <form onSubmit={handleSubmit} className="h-fit border border-slate-200 bg-white rounded-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold uppercase text-slate-500">
            {editingId ? "Edit Entry" : "Add a Calendar Entry"}
          </h2>
          {editingId ? (
            <button
              type="button"
              onClick={resetForm}
              className="text-xs font-semibold text-[#0D1282] hover:underline"
            >
              Cancel edit
            </button>
          ) : null}
        </div>

        <div className="grid gap-4 p-4 md:grid-cols-2">
          <label className="block">
            <span className={labelClass}>Category</span>
            <div className="relative">
              <select
                value={form.category}
                onChange={(event) =>
                  handleCategoryChange(event.target.value as CalendarCategory)
                }
                className={`${inputClass} appearance-none pr-12`}
              >
                {calendarCategories.map((category) => (
                  <option key={category} value={category}>
                    {calendarCategoryLabels[category]}
                  </option>
                ))}
              </select>
              <FiChevronDown
                aria-hidden="true"
                className="pointer-events-none absolute right-5 top-1/2 mt-2 h-4 w-4 -translate-y-1/2 text-slate-500"
              />
            </div>
          </label>

          <label className="block">
            <span className={labelClass}>Title</span>
            <input required maxLength={120} value={form.title} onChange={handleTextChange("title")} className={inputClass} placeholder="e.g. Deepavali" />
          </label>

          {fields.showBranch ? (
            <label className="block">
              <span className={labelClass}>Branch</span>
              <div className="relative">
                <select
                  value={form.branchId}
                  onChange={handleTextChange("branchId")}
                  className={`${inputClass} appearance-none pr-12`}
                >
                  <option value="">All branches</option>
                  {branches.map((branch) => (
                    <option key={branch._id} value={branch._id}>
                      {branch.code} · {branch.name}
                    </option>
                  ))}
                </select>
                <FiChevronDown
                  aria-hidden="true"
                  className="pointer-events-none absolute right-5 top-1/2 mt-1 h-4 w-4 -translate-y-1/2 text-slate-500"
                />
              </div>
            </label>
          ) : null}

          {fields.showCountry ? (
            <label className="block">
              <span className={labelClass}>Country code</span>
              <input
                required
                maxLength={2}
                value={form.countryCode}
                onChange={handleTextChange("countryCode")}
                className={`${inputClass} uppercase`}
                placeholder="e.g. IN"
              />
            </label>
          ) : null}

          {fields.showLocation ? (
            <label className="block">
              <span className={labelClass}>Route / location</span>
              <input
                required={form.category === "FLIGHT_CLOSING_TIME"}
                maxLength={120}
                value={form.locationLabel}
                onChange={handleTextChange("locationLabel")}
                className={inputClass}
                placeholder="e.g. London (LHR)"
              />
            </label>
          ) : null}

          {fields.showDate ? (
            <label className="block">
              <span className={labelClass}>
                {form.category === "PEAK_SEASON_RESTRICTION" ? "Start date" : "Date"}
              </span>
              <input type="date" required={form.category !== "DESTINATION_HOLIDAY"} value={form.date} onChange={handleTextChange("date")} className={inputClass} />
            </label>
          ) : null}

          {fields.showEndDate ? (
            <label className="block">
              <span className={labelClass}>End date</span>
              <input type="date" value={form.endDate} onChange={handleTextChange("endDate")} className={inputClass} />
            </label>
          ) : null}

          {fields.showTime ? (
            <label className="block">
              <span className={labelClass}>Time (HH:mm)</span>
              <input
                required
                type="time"
                value={form.time}
                onChange={handleTextChange("time")}
                className={inputClass}
              />
            </label>
          ) : null}

          {fields.showWeekend ? (
            <label className="block">
              <span className={labelClass}>Weekend delivery</span>
              <div className="relative">
                <select
                  required
                  value={form.weekendDeliveryAvailable}
                  onChange={handleTextChange("weekendDeliveryAvailable")}
                  className={`${inputClass} appearance-none pr-12`}
                >
                  <option value="">Select availability</option>
                  <option value="true">Available</option>
                  <option value="false">Not available</option>
                </select>
                <FiChevronDown
                  aria-hidden="true"
                  className="pointer-events-none absolute right-5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
                />
              </div>
            </label>
          ) : null}

          <label className="block md:col-span-2">
            <span className={labelClass}>Details (optional)</span>
            <textarea
              maxLength={500}
              rows={2}
              value={form.description}
              onChange={handleTextChange("description")}
              className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-900 focus:ring-2 focus:ring-blue-100"
              placeholder="Notes, exceptions, what is restricted..."
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 p-4">
          <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-800">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(event) => updateField("active", event.target.checked)}
              className="h-4 w-4 accent-[#0D1282]"
            />
            Active
          </label>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex h-10 items-center gap-2 bg-blue-900 px-4 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            <FiSave aria-hidden="true" className="h-4 w-4" />
            {busy ? "Saving..." : editingId ? "Update Entry" : "Add Entry"}
          </button>
        </div>
      </form>

      <aside className="border border-slate-200 bg-white rounded-2xl">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold uppercase text-slate-500">Calendar Entries</h2>
        </div>

        <div className="max-h-[36rem] divide-y divide-slate-100 overflow-y-auto">
          {entries.length === 0 ? (
            <div className="p-4 text-sm text-slate-500">No calendar entries yet.</div>
          ) : entries.map((entry) => (
            <div key={entry.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-slate-950">{entry.title}</p>
                    <span className="rounded-full bg-[#0D1282]/[0.08] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#0D1282]">
                      {calendarCategoryLabels[entry.category].split(" ")[0]}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {[
                      entry.branch ? `${entry.branch.code} · ${entry.branch.name}` : null,
                      entry.countryCode ? entry.countryCode : null,
                      entry.locationLabel ? entry.locationLabel : null,
                      entry.time ? `at ${entry.time}` : null,
                      entry.date ? entry.date.slice(0, 10) : null,
                      entry.endDate ? `→ ${entry.endDate.slice(0, 10)}` : null,
                      entry.weekendDeliveryAvailable === null ? null : entry.weekendDeliveryAvailable ? "Weekend available" : "No weekend delivery"
                    ].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => loadEntry(entry)}
                    aria-label={`Edit ${entry.title}`}
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition hover:border-[#0D1282] hover:text-[#0D1282]"
                  >
                    <FiEdit3 aria-hidden="true" className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(entry)}
                    aria-label={`Delete ${entry.title}`}
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition hover:border-[#D71313] hover:text-[#D71313]"
                  >
                    <FiTrash2 aria-hidden="true" className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => { resetForm(); window.scrollTo({ top: 0, behavior: "smooth" }); }}
          className="flex w-full items-center justify-center gap-2 border-t border-slate-200 px-4 py-3 text-sm font-semibold text-[#0D1282] hover:bg-[#0D1282]/5"
        >
          <FiPlus aria-hidden="true" className="h-4 w-4" />
          New entry
        </button>
      </aside>

      {error ? <div className="xl:col-span-2 border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div> : null}
      {message ? <div className="xl:col-span-2 border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{message}</div> : null}
    </div>
  );

}
