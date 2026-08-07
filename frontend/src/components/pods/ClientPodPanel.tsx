"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  FiAlertTriangle,
  FiCheckCircle,
  FiChevronDown,
  FiTruck,
} from "react-icons/fi";
import { HiOutlineClipboardDocumentCheck } from "react-icons/hi2";

import { toast } from "react-toastify";

import PodEvidenceGallery from "@/components/pods/PodEvidenceGallery";
import PodStatusBadge from "@/components/pods/PodStatusBadge";

import {
  getClientPod,
  reportPodIssue,
  type PodAssignment,
} from "@/lib/pods";

export default function ClientPodPanel({
  shipmentId,
}: {
  shipmentId: string;
}) {
  const [pod, setPod] = useState<PodAssignment | null>(null);
  const [loading, setLoading] = useState(true);
  const [reporting, setReporting] = useState(false);

  const [issue, setIssue] = useState({
    category: "NOT_RECEIVED",
    details: "",
  });

  useEffect(() => {
    let active = true;

    void getClientPod(shipmentId)
      .then((result) => {
        if (active) {
          setPod(result.pod);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [shipmentId]);

  async function submit(event: FormEvent) {
    event.preventDefault();

    try {
      const result = await reportPodIssue(
        shipmentId,
        issue.category,
        issue.details,
      );

      toast.success(result.message);

      setReporting(false);

      setIssue({
        category: "NOT_RECEIVED",
        details: "",
      });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Issue could not be reported.",
      );
    }
  }

  if (loading) {
    return (
      <div className="h-40 animate-pulse rounded-2xl bg-slate-100" />
    );
  }

  if (!pod) {
    return null;
  }

  const verified = pod.revisions?.find(
    (item) => item.status === "VERIFIED",
  );

  return (
    <>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {/* HEADER */}
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 px-5 py-5">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#0D1282]/[0.07] text-[#0D1282]">
              <HiOutlineClipboardDocumentCheck  className="h-5 w-5" />
            </div>

            <div className="min-w-0">
              <h2 className="text-base font-semibold text-slate-950">
                Proof of delivery
              </h2>

              <p className="mt-1 truncate text-sm text-slate-500">
                {pod.deliveryPartnerId?.name ??
                  "Destination delivery team"}

                <span className="mx-2 text-slate-300">·</span>

                {pod.partnerReference}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <PodStatusBadge status={pod.status} />

            {verified ? (
              <PodStatusBadge status="VERIFIED" />
            ) : (
              <PodStatusBadge status="UNDER_REVIEW" />
            )}
          </div>
        </div>

        {!verified ? (
          /* UNDER REVIEW */
          <div className="px-5 py-5">
            <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <FiAlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />

              <div>
                <p className="text-sm font-semibold text-amber-900">
                  POD verification in progress
                </p>

                <p className="mt-1 text-sm leading-6 text-amber-800">
                  Delivery evidence is being collected or reviewed.
                  Verified proof of delivery will appear here once it has
                  been approved.
                </p>
              </div>
            </div>
          </div>
        ) : (
          /* VERIFIED CONTENT */
          <div className="grid lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
            {/* LEFT SIDE - DELIVERY INFORMATION */}
            <div className="border-b border-slate-100 px-5 py-5 lg:border-b-0 lg:border-r">
              <div className="space-y-7">
                {/* Recipient */}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">
                    Recipient
                  </p>

                  <p className="mt-2 text-base font-semibold text-slate-950">
                    {verified.recipientName}
                  </p>

                  <p className="mt-1 text-sm capitalize text-slate-500">
                    {verified.recipientRelationship
                      .replace(/_/g, " ")
                      .toLowerCase()}
                  </p>
                </div>

                {/* Delivered */}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">
                    Delivered
                  </p>

                  <p className="mt-2 text-sm font-semibold leading-6 text-slate-950">
                    {new Date(
                      verified.deliveredAt,
                    ).toLocaleString()}
                  </p>

                  <p className="mt-1 text-xs text-slate-500">
                    {verified.destinationTimeZone}
                  </p>
                </div>

                {/* Parcels */}
                <div>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">
                      Parcels
                    </p>

                    <span className="text-xs font-medium text-slate-400">
                      {verified.parcelNumbers.length}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {verified.parcelNumbers.map((parcel) => (
                      <span
                        key={parcel}
                        className="max-w-full break-all rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-700"
                      >
                        {parcel}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* RIGHT SIDE - EVIDENCE + ACTION */}
            <div className="flex min-w-0 flex-col px-5 py-5">
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-slate-950">
                  Delivery evidence
                </h3>

                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Photos, signatures and supporting evidence provided
                  by the delivery team.
                </p>
              </div>

              <div className="min-w-0 flex-1">
                <PodEvidenceGallery
                  assignmentId={pod.id}
                  revision={verified}
                  audience="client"
                />
              </div>

              <div className="mt-5 flex justify-end border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setReporting(true)}
                  className="inline-flex h-10 items-center gap-2 rounded-lg border border-red-200 px-4 text-sm font-semibold text-red-600 transition hover:border-red-300 hover:bg-red-50 hover:text-red-700"
                >
                  <FiAlertTriangle className="h-4 w-4" />
                  Report POD issue
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* REPORT ISSUE MODAL */}
      {reporting ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 backdrop-blur-[1px] sm:items-center sm:p-4">
          <form
            onSubmit={submit}
            className="w-full max-w-lg overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
          >
            {/* Modal header */}
            <div className="border-b border-slate-100 px-5 py-4">
              <h3 className="text-lg font-semibold text-slate-950">
                Report POD issue
              </h3>

              <p className="mt-1 text-sm leading-5 text-slate-500">
                The verified POD remains unchanged while Swiftline
                investigates your report.
              </p>
            </div>

            {/* Modal body */}
            <div className="space-y-4 px-5 py-5">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">
                  Issue type
                </span>

                <div className="relative">
                  <select
                    value={issue.category}
                    onChange={(event) =>
                      setIssue((current) => ({
                        ...current,
                        category: event.target.value,
                      }))
                    }
                    className="h-11 w-full appearance-none rounded-lg border border-slate-300 bg-white px-3 pr-11 text-sm text-slate-900 outline-none transition focus:border-[#0D1282] focus:ring-2 focus:ring-[#0D1282]/10"
                  >
                    <option value="NOT_RECEIVED">
                      Shipment not received
                    </option>

                    <option value="WRONG_RECIPIENT">
                      Wrong recipient
                    </option>

                    <option value="MISSING_PARCEL">
                      Missing parcel
                    </option>

                    <option value="DAMAGED_PARCEL">
                      Damaged parcel
                    </option>

                    <option value="INCORRECT_LOCATION">
                      Incorrect location
                    </option>

                    <option value="SIGNATURE_CONCERN">
                      Signature concern
                    </option>

                    <option value="PHOTO_CONCERN">
                      Photo concern
                    </option>

                    <option value="OTHER">Other</option>
                  </select>

                  <FiChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                </div>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">
                  Details
                </span>

                <textarea
                  required
                  minLength={5}
                  value={issue.details}
                  onChange={(event) =>
                    setIssue((current) => ({
                      ...current,
                      details: event.target.value,
                    }))
                  }
                  placeholder="Explain what is wrong with the proof of delivery..."
                  className="min-h-32 w-full resize-y rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#0D1282] focus:ring-2 focus:ring-[#0D1282]/10"
                />
              </label>
            </div>

            {/* Modal footer */}
            <div className="flex items-center justify-end gap-3 border-t border-slate-100 bg-slate-50/50 px-5 py-4">
              <button
                type="button"
                onClick={() => setReporting(false)}
                className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Cancel
              </button>

              <button
                type="submit"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white transition hover:bg-red-700"
              >
                <FiCheckCircle className="h-4 w-4" />
                Send report
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}