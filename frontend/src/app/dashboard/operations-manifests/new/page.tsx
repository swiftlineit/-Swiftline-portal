"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { FiChevronDown } from "react-icons/fi";
import { toast } from "react-toastify";
import { DashboardLoading } from "@/components/DashboardShell";
import CountryFlag from "@/components/CountryFlag";
import { countryOptions } from "@/lib/branches";
import {
  createOperationsManifest,
  listManifestBranches,
  type ManifestHeader,
} from "@/lib/operationsManifests";
import { OPERATIONS_AREA } from "@/lib/roles";
import { useAdminUser } from "@/lib/useAdminUser";

// Almost every flight clears through the UK agent, so the TO block starts filled in
// and the operator edits it only when the destination agent differs.
const defaultDestinationAgent = [
  "M/S SWIFTLINE CARGO LTD",
  "CFL CODE:SLC",
  "14 MARVVELL AVENUE",
  "UB4 0QR",
  "EORI:GB047637985000",
  "UNITED KINGDOM",
].join("\n");

const valueTypeOptions = [
  { code: "HV", label: "HVG" },
  { code: "LV", label: "LVG" },
  { code: "TS", label: "TS" },
  { code: "Docs", label: "Docs" },
];

const originIataOptions = [
  { code: "DEL", label: "DEL" },
  { code: "AMD", label: "AMD" },
  { code: "BOM", label: "BOM" },
  { code: "JAI", label: "JAI" },
  { code: "HYD", label: "HYD" },
  { code: "BLR", label: "BLR" },
];

const destinationIataOptions = [
  { code: "LHR", label: "LHR" },
  { code: "LGW", label: "LGW" },
  { code: "STN", label: "STN" },
  { code: "LTN", label: "LTN" },
  { code: "LCY", label: "LCY" },
  { code: "SEN", label: "SEN" },
];

const emptyHeader: ManifestHeader = {
  destinationAgent: defaultDestinationAgent,
  destinationCountryCode: "",
  destinationCountryName: "",
  flightNumber: "",
  departureDate: "",
  mawbNumber: "",
  originIataCode: "",
  destinationIataCode: "",
  valueType: "LV",
};

const controlBase =
  "h-11 w-full rounded-2xl border border-slate-300 bg-white px-3 text-sm normal-case text-slate-950 outline-none focus:border-[#0D1282] focus:ring-2 focus:ring-[#F0DE36]";
const controlClass = `mt-2 ${controlBase}`;
// `padding-right` moves the text, never the native arrow. The arrow is only movable
// once the browser control is removed and the chevron is drawn beside it.
const selectClass = `${controlBase} appearance-none pr-10 `;
const labelClass = "text-xs  uppercase text-slate-600";

/** Positions the chevron inset from the right border, clear of the rounded corner. */
function SelectShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative mt-2">
      {children}
      <FiChevronDown
        aria-hidden
        className="pointer-events-none  rounded-2xl absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
      />
    </div>
  );
}

/** Flags need a listbox, because a native `<option>` can only contain text. */
function CountrySelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (code: string, name: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const selected = countryOptions.find((item) => item.code === value);

  useEffect(() => {
    if (!open) return;
    function closeOnOutsideClick(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative mt-2">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`${controlBase} flex items-center gap-2 pr-10 text-left`}
      >
        {selected ? <CountryFlag code={selected.code} /> : null}
        <span
          className={
            selected ? "truncate text-slate-950" : "truncate text-slate-400"
          }
        >
          {selected?.name ?? "Select country"}
        </span>
      </button>
      <FiChevronDown
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
      />

      {open ? (
        <div
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg"
        >
          {countryOptions.map((item) => (
            <button
              key={item.code}
              type="button"
              role="option"
              aria-selected={item.code === value}
              onClick={() => {
                onChange(item.code, item.name);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-[#EEEDED] ${item.code === value ? "bg-[#EEEDED]/70 font-semibold text-[#0D1282]" : "text-slate-800"}`}
            >
              <CountryFlag code={item.code} />
              <span className="truncate">{item.name}</span>
              <span className="ml-auto shrink-0 text-[11px] text-slate-400">
                {item.code}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function NewOperationsManifestPage() {
  const { user, loading } = useAdminUser(OPERATIONS_AREA);
  const router = useRouter();
  const [branches, setBranches] = useState<
    Array<{ id: string; name: string; code: string }>
  >([]);
  const [branchId, setBranchId] = useState("");
  const [header, setHeader] = useState(emptyHeader);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user)
      void listManifestBranches()
        .then((data) => setBranches(data.branches))
        .catch((error) => toast.error(error.message));
  }, [user]);

  if (loading || !user) return <DashboardLoading />;

  const field = (key: keyof ManifestHeader, value: string) =>
    setHeader((current) => ({ ...current, [key]: value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!branchId) return toast.error("Select the origin branch.");
    setSaving(true);
    try {
      const result = await createOperationsManifest({ branchId, header });
      toast.success(`${result.manifestNumber} created.`);
      router.push(`/dashboard/operations-manifests/${result.manifestId}`);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Manifest could not be created.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
      <form onSubmit={submit} className="mx-auto max-w-5xl">
        <div className="mb-6 rounded-xl border border-[#EEEDED] bg-white p-5 shadow-sm">
          <Link
            href="/dashboard/operations-manifests"
            className="text-sm font-semibold text-[#0D1282]"
          >
            Back to manifests
          </Link>
          <h1 className="mt-4 text-2xl font-semibold ">
            Create Operations Manifest
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Set the branch and flight route. A first bag opens automatically so
            you can start scanning.
          </p>
        </div>

        <section className="overflow-hidden rounded-2xl border border-[#EEEDED] bg-white shadow-sm">
          <div className="border-b border-[#EEEDED] bg-[#EEEDED]/70 px-6 py-4">
            <h2 className="font-semibold text-slate-600">Route And Flight</h2>
          </div>
          <div className="grid gap-5 p-6 md:grid-cols-2">
            <label className={labelClass}>
              Origin Branch *
              <SelectShell>
                <select
                  value={branchId}
                  onChange={(event) => setBranchId(event.target.value)}
                  className={selectClass}
                >
                  <option value="">Select branch</option>
                  {branches.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} ({item.code})
                    </option>
                  ))}
                </select>
              </SelectShell>
            </label>

            <div className={labelClass}>
              Destination Country *
              <CountrySelect
                value={header.destinationCountryCode}
                onChange={(code, name) => {
                  field("destinationCountryCode", code);
                  field("destinationCountryName", name);
                }}
              />
            </div>

            <label className={`${labelClass} md:col-span-2`}>
              Destination Agent Details *
              <textarea
                value={header.destinationAgent}
                onChange={(event) =>
                  field("destinationAgent", event.target.value)
                }
                rows={6}
                placeholder="Agent name, company, complete address and contact details"
                className="mt-2 w-full resize-y rounded-2xl border border-slate-300 p-3 text-sm normal-case text-slate-950 outline-none focus:border-[#0D1282] focus:ring-2 focus:ring-[#F0DE36]"
              />
            </label>

            <label className={labelClass}>
              Flight Number *
              <input
                value={header.flightNumber}
                onChange={(event) =>
                  field("flightNumber", event.target.value.toUpperCase())
                }
                placeholder="EY-219"
                className={controlClass}
              />
            </label>

            <label className={labelClass}>
              Departure Date *
              <input
                type="date"
                value={header.departureDate}
                onChange={(event) => field("departureDate", event.target.value)}
                className={controlClass}
              />
            </label>

            <label className={labelClass}>
              MAWB Number *
              <input
                value={header.mawbNumber}
                onChange={(event) =>
                  field("mawbNumber", event.target.value.toUpperCase())
                }
                placeholder="607-54691055"
                className={controlClass}
              />
            </label>

            <label className={labelClass}>
              Value Type *
              <SelectShell>
                <select
                  value={header.valueType}
                  onChange={(event) => field("valueType", event.target.value)}
                  className={selectClass}
                >
                  {valueTypeOptions.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </SelectShell>
            </label>

            <label className={labelClass}>
              Origin IATA *
              <SelectShell>
                <select
                  value={header.originIataCode}
                  onChange={(event) =>
                    field("originIataCode", event.target.value)
                  }
                  className={selectClass}
                >
                  <option value="">Select origin airport</option>
                  {originIataOptions.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </SelectShell>
            </label>

            <label className={labelClass}>
              Destination IATA *
              <SelectShell>
                <select
                  value={header.destinationIataCode}
                  onChange={(event) =>
                    field("destinationIataCode", event.target.value)
                  }
                  className={selectClass}
                >
                  <option value="">Select destination airport</option>
                  {destinationIataOptions.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </SelectShell>
            </label>
          </div>
        </section>

        <div className="mt-5 flex justify-end gap-3">
          <Link
            href="/dashboard/operations-manifests"
            className="inline-flex h-11 items-center rounded-4xl border border-[#0D1282]/20 bg-white px-5 text-sm font-semibold text-[#0D1282]"
          >
            Cancel
          </Link>
          <button
            disabled={saving}
            className="h-11 rounded-4xl bg-[#0D1282] tracking-wide px-6 text-sm font-semibold text-white hover:bg-[#0D1282]/90 disabled:opacity-60"
          >
            {saving ? "Creating..." : "Create Manifest"}
          </button>
        </div>
      </form>
  );
}
