import Link from "next/link";
import { FiCheckCircle } from "react-icons/fi";

export default function ShipmentDraftReadyCard({
  title,
  href,
  consignee,
  postcode,
  parcelCount,
  totalWeightKg
}: {
  title: string;
  href: string;
  consignee?: string;
  postcode?: string;
  parcelCount: number;
  totalWeightKg: number;
}) {
  return (
    <section className="border border-emerald-200 bg-emerald-50 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
          <FiCheckCircle aria-hidden="true" className="h-4 w-4 shrink-0" />
          {title}
        </div>
        {/* <Link
          href={href}
          className="inline-flex h-9 items-center justify-center bg-emerald-700 px-3 text-sm font-semibold text-white hover:bg-emerald-800"
        >
          Open Draft
        </Link> */}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 justify-between align -center  gap-y-4 text-sm">
        <Detail label="Consignee" value={consignee} />
        <Detail label="Postcode" value={postcode} />
        <Detail label="Parcels" value={String(parcelCount)} />
        <Detail label="Total Weight" value={`${totalWeightKg.toFixed(2)} kg`} />
      </dl>
       <Link
          href={href}
          className="w-full inline-flex h-9 items-center justify-center mt-5 bg-emerald-700 px-3 text-sm font-semibold text-white hover:bg-emerald-800"
        >
          Open Draft
        </Link>
    </section>
  );
}

function Detail({ label, value }: { label: string; value?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase text-emerald-700">{label}</dt>
      <dd className="mt-1 break-words font-semibold text-emerald-950">{value || "Not available"}</dd>
    </div>
  );
}
