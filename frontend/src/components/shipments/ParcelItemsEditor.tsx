"use client";

import { useEffect, useState } from "react";
import { FiMinus, FiPlus } from "react-icons/fi";
import { toast } from "react-toastify";
import { ShipmentFieldLabel } from "@/components/shipments/ShipmentFormControls";
import {
  fetchHsCodeSuggestions,
  minHsCodeQueryLength,
  type HsCodeSuggestion,
} from "@/lib/hsCodes";
import {
  createEmptyParcelItem,
  getHsnCodeError,
  getParcelItemAmount,
  getPositiveNumberError,
  maxParcelItems,
  parcelItemUnitTypeValues,
  type ParcelItem,
} from "@/lib/parcelItems";
import { findRestrictedCategories } from "@/lib/restrictedGoods";

const rowGrid = "lg:grid-cols-[minmax(0,1fr)_120px_88px_74px_96px_96px_44px]";

/**
 * Per-parcel contents: one row per distinct good. Each row becomes a single line
 * on the customs (shipment) invoice, so it carries the HS code, unit of measure,
 * quantity and unit rate that document needs. Amount is derived (qty x rate) and
 * shown read-only so it can never disagree with its inputs.
 *
 * Restricted descriptions highlight red and raise a toast on blur. The joined
 * descriptions become the parcel's contentsDescription on save, which is what the
 * EDI export, manifest, carrier payload and labels keep reading.
 */
export function ParcelItemsEditor({
  items,
  onChange,
  revealError = false,
  maxItems = maxParcelItems,
}: {
  items: ParcelItem[];
  onChange: (items: ParcelItem[]) => void;
  revealError?: boolean;
  maxItems?: number;
}) {
  // The description being typed drives the HS code suggestions below it. Only
  // the focused row looks anything up, so one lookup runs at a time.
  const [activeRow, setActiveRow] = useState<number | null>(null);
  // Results are kept with the query they answer, so anything the user has since
  // typed past simply stops being rendered rather than needing to be cleared.
  const [suggestions, setSuggestions] = useState<{
    query: string;
    results: HsCodeSuggestion[];
  }>({ query: "", results: [] });

  const activeQuery =
    activeRow === null ? "" : (items[activeRow]?.description ?? "").trim();
  const visibleSuggestions =
    activeQuery && suggestions.query === activeQuery ? suggestions.results : [];

  useEffect(() => {
    if (activeQuery.length < minHsCodeQueryLength) return;

    // Debounced so a lookup follows the typing rather than every keystroke, and
    // cancelled on unmount so a late reply cannot land on a different row.
    let active = true;
    const timer = window.setTimeout(() => {
      void fetchHsCodeSuggestions(activeQuery).then((results) => {
        if (active) setSuggestions({ query: activeQuery, results });
      });
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [activeQuery]);

  function updateItem(index: number, field: keyof ParcelItem, value: string) {
    onChange(
      items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item,
      ),
    );
  }

  function addItem() {
    if (items.length >= maxItems) return;
    onChange([...items, createEmptyParcelItem()]);
  }

  function removeItem(index: number) {
    // Always leave one row so the parcel never renders with no contents input.
    if (items.length <= 1) {
      onChange([createEmptyParcelItem()]);
      return;
    }
    onChange(items.filter((_, itemIndex) => itemIndex !== index));
  }

  const declaredTotal = items.reduce(
    (total, item) => total + getParcelItemAmount(item),
    0,
  );

  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-3">
        <ShipmentFieldLabel
          required
          tooltip="Each distinct item in this box, with its HS code, quantity and unit rate"
        >
          Contents
        </ShipmentFieldLabel>
        <button
          type="button"
          onClick={addItem}
          disabled={items.length >= maxItems}
          className="inline-flex items-center gap-1 rounded-full border border-blue-900 px-3 py-1 text-xs font-semibold text-blue-900 transition hover:bg-blue-900 hover:text-white disabled:cursor-not-allowed disabled:border-slate-300 disabled:text-slate-400 disabled:hover:bg-transparent"
        >
          <FiPlus aria-hidden="true" /> Add Item
        </button>
      </div>

      {/* Column captions, so the compact inputs below stay readable. */}
      <div
        className={`mt-2 hidden gap-2 px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 lg:grid ${rowGrid}`}
      >
        <span>Description</span>
        <span>HS Code</span>
        <span>Unit Type</span>
        <span>Qty</span>
        <span>Unit Rate</span>
        <span>Amount</span>
        <span className="sr-only">Remove</span>
      </div>

      <div className="mt-1 space-y-2">
        {items.map((item, index) => {
          const restricted = findRestrictedCategories(item.description);
          const hsnError = getHsnCodeError(item.hsnCode);
          const quantityError = getPositiveNumberError(
            item.quantity,
            "Quantity",
          );
          const unitRateError = getPositiveNumberError(
            item.unitRate,
            "Unit rate",
          );
          const showDescriptionError = restricted.length > 0;
          const showHsnError =
            Boolean(hsnError) &&
            (revealError || item.hsnCode.trim().length > 0);
          const rowError = showDescriptionError
            ? `${restricted.join(", ")} is a restricted item and cannot be shipped.`
            : showHsnError
              ? hsnError
              : revealError
                ? quantityError || unitRateError
                : "";

          return (
            <div key={index} className={`grid gap-2 ${rowGrid} lg:items-start`}>
              <div className="relative min-w-0">
                <input
                  type="text"
                  value={item.description}
                  onChange={(event) =>
                    updateItem(index, "description", event.target.value)
                  }
                  onFocus={() => setActiveRow(index)}
                  onBlur={() => {
                    setActiveRow((current) =>
                      current === index ? null : current,
                    );
                    if (restricted.length) {
                      toast.error(
                        `${restricted.join(", ")} is a restricted item and cannot be shipped.`,
                        {
                          toastId: `restricted-${restricted.join("-")}`,
                        },
                      );
                    }
                  }}
                  placeholder={`Item ${index + 1} description`}
                  maxLength={120}
                  aria-label={`Item ${index + 1} description`}
                  aria-invalid={showDescriptionError}
                  className={`h-11 w-full min-w-0 rounded-xl border px-3.5 text-sm outline-none transition focus:ring-2 ${
                    showDescriptionError
                      ? "border-red-400 bg-red-50 focus:border-red-500 focus:ring-red-100"
                      : revealError && !item.description.trim()
                        ? "border-red-400 bg-white focus:border-red-500 focus:ring-red-100"
                        : "border-slate-300 bg-white focus:border-blue-900 focus:ring-blue-100"
                  }`}
                />
                {/* Suggested tariff codes for what was typed. Picking one only
                    fills the HS code; the description stays as the sender wrote it. */}
                {activeRow === index && visibleSuggestions.length ? (
                  <ul className="absolute left-0 top-full z-20 mt-1 max-h-60 w-[min(30rem,85vw)] overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                    <li className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      Suggested HS codes
                    </li>
                    {visibleSuggestions.map((suggestion) => (
                      <li key={suggestion.code}>
                        <button
                          type="button"
                          // Keeps focus on the input so blur does not close the
                          // list before the click lands.
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() =>
                            updateItem(index, "hsnCode", suggestion.code)
                          }
                          className="flex w-full items-start gap-2 px-3 py-2 text-left text-xs transition hover:bg-blue-50"
                        >
                          <span className="font-semibold text-blue-900">
                            {suggestion.code}
                          </span>
                          <span className="text-slate-600">
                            {suggestion.description}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <input
                type="text"
                inputMode="numeric"
                value={item.hsnCode}
                // Digits only: an HS code is 4, 6, 8 or 10 numerals.
                onChange={(event) =>
                  updateItem(
                    index,
                    "hsnCode",
                    event.target.value.replace(/\D/g, "").slice(0, 10),
                  )
                }
                onBlur={() => {
                  if (hsnError && item.hsnCode.trim())
                    toast.error(hsnError, { toastId: hsnError });
                }}
                placeholder="HS code"
                aria-label={`Item ${index + 1} HS code`}
                aria-invalid={showHsnError}
                className={`h-11 w-full min-w-0 rounded-xl border px-3.5 text-sm outline-none transition focus:ring-2 ${
                  showHsnError
                    ? "border-red-400 bg-white focus:border-red-500 focus:ring-red-100"
                    : "border-slate-300 bg-white focus:border-blue-900 focus:ring-blue-100"
                }`}
              />
              <div className="relative">
                <select
                  value={item.unitType}
                  onChange={(event) =>
                    updateItem(index, "unitType", event.target.value)
                  }
                  aria-label={`Item ${index + 1} unit type`}
                  className="h-11 w-full appearance-none rounded-xl border border-slate-300 bg-white pl-3 pr-10 text-sm outline-none transition focus:border-blue-900 focus:ring-2 focus:ring-blue-100"
                >
                  {parcelItemUnitTypeValues.map((unit) => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))}
                </select>

                <svg
                  className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                step="1"
                value={item.quantity}
                onChange={(event) =>
                  updateItem(index, "quantity", event.target.value)
                }
                placeholder="Qty"
                aria-label={`Item ${index + 1} quantity`}
                aria-invalid={Boolean(revealError && quantityError)}
                className={`h-11 w-full min-w-0 rounded-xl border px-2.5 text-sm outline-none transition focus:ring-2 ${
                  revealError && quantityError
                    ? "border-red-400 bg-white focus:border-red-500 focus:ring-red-100"
                    : "border-slate-300 bg-white focus:border-blue-900 focus:ring-blue-100"
                }`}
              />
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={item.unitRate}
                onChange={(event) =>
                  updateItem(index, "unitRate", event.target.value)
                }
                placeholder="Rate"
                aria-label={`Item ${index + 1} unit rate`}
                aria-invalid={Boolean(revealError && unitRateError)}
                className={`h-11 w-full min-w-0 rounded-xl border px-2.5 text-sm outline-none transition focus:ring-2 ${
                  revealError && unitRateError
                    ? "border-red-400 bg-white focus:border-red-500 focus:ring-red-100"
                    : "border-slate-300 bg-white focus:border-blue-900 focus:ring-blue-100"
                }`}
              />
              {/* Derived, never entered, so it cannot drift from quantity x rate. */}
              <div
                aria-label={`Item ${index + 1} amount`}
                className="flex h-11 w-full min-w-0 items-center justify-start rounded-xl border border-slate-200 bg-slate-100 px-2.5 text-sm font-semibold text-slate-700"
              >
                {getParcelItemAmount(item).toFixed(2)}
              </div>
              <button
                type="button"
                onClick={() => removeItem(index)}
                disabled={
                  items.length <= 1 && !item.description && !item.hsnCode
                }
                aria-label={`Remove item ${index + 1}`}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-300 text-red-600 transition hover:border-red-300 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:border-slate-300 disabled:hover:bg-transparent"
              >
                <FiMinus aria-hidden="true" />
              </button>

              {rowError ? (
                <p className="text-xs font-semibold text-red-600 lg:col-span-7">
                  {rowError}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Declared value for this box, matching what the customs invoice will show. */}
      <div className="mt-2 flex justify-end gap-3 px-1 text-xs">
        <span className="font-semibold uppercase tracking-wide text-slate-500">
          Box Declared Value
        </span>
        <span className="font-semibold text-slate-900">
          {declaredTotal.toFixed(2)}
        </span>
      </div>
    </div>
  );
}
