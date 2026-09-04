import { FiBriefcase, FiUsers } from "react-icons/fi";

export default function PublicBusinessAccountReviewCard({
  title,
  description,
  kind,
  rows,
  onEdit,
  columns = 2,
}: {
  title: string;
  description: string;
  kind: "contact" | "company";
  rows: [string, string][];
  onEdit: () => void;
  columns?: 2 | 3;
}) {
  const Icon = kind === "contact" ? FiUsers : FiBriefcase;

  return (
    <section className="overflow-hidden rounded-xl border border-[#C7DADD] bg-white">
      <div className="flex flex-col gap-3 border-b border-[#DCE8E9] bg-[#F8FBFB] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#EAF4F4] text-[#0D1282]">
            <Icon className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-950">{title}</p>
            <p className="mt-0.5 text-xs leading-5 text-slate-500">
              {description}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex min-h-9 w-fit items-center justify-center rounded-lg border border-[#C7DADD] bg-white px-3 text-xs font-semibold text-[#0D1282] transition hover:border-[#AFC8CD] hover:bg-[#EAF4F4]"
        >
          Edit section
        </button>
      </div>
      <dl
        className={`grid ${columns === 3 ? "sm:grid-cols-2 xl:grid-cols-3" : "sm:grid-cols-2"}`}
      >
        {rows.map(([label, value], index) => {
          const isVerifiedEmail =
            label === "Email" && value.toLowerCase().includes("verified");
          return (
            <div
              key={`${label}-${index}`}
              className={`min-w-0 border-b border-[#EDF2F2] px-4 py-3.5 sm:px-5 ${index % 2 === 1 ? "bg-[#FCFDFD]" : "bg-white"}`}
            >
              <dt className="text-[11px] font-semibold text-slate-500">
                {label}
              </dt>
              <dd
                className={`mt-1.5 wrap-break-words text-sm font-semibold leading-5 ${isVerifiedEmail ? "text-emerald-700" : "text-slate-900"} ${label.toLowerCase() === "email" ? "" : "uppercase"}`}
              >
                {value || "-"}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
