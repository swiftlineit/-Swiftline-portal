/**
 * The HTTP half of table exports.
 *
 * Kept apart from `tableExport.service.ts` so the writers stay pure and
 * testable without an Express request in hand.
 *
 * Exports are served from the same controller as the table they export, not
 * from a parallel endpoint. Every list in this portal decides what a login is
 * allowed to see- which accounts, which branches- before it queries anything,
 * and a second endpoint reimplementing that is how one of them ends up subtly
 * more generous than the other. Sharing the controller makes the export scope
 * wrong only if the table is already wrong.
 */
import type { Request, Response } from "express";
import {
  buildTablePdf,
  buildTableWorkbook,
  exportFileMeta,
  type TableExportInput
} from "./tableExport.service.js";

export type TableExportFormat = "xlsx" | "pdf";

/**
 * How many rows an export may contain.
 *
 * An export is one request holding every matching row in memory while it is
 * formatted, so it cannot be unbounded. Ten thousand covers a year of shipments
 * for the accounts this portal serves; past that the honest answer is a date
 * filter, which the caller is told about rather than silently given a short file.
 */
export const EXPORT_ROW_CAP = 10_000;

/** The requested export format, or null for an ordinary JSON page. */
export function exportFormat(request: Request): TableExportFormat | null {
  const value = typeof request.query.format === "string" ? request.query.format.toLowerCase() : "";
  return value === "xlsx" || value === "pdf" ? value : null;
}

/**
 * Pagination for a list request, widened when it is really an export.
 *
 * An export of "page 2 of 14" is not an export of the table, so the page is
 * pinned to the first and the limit opened to the cap.
 */
export function listWindow(request: Request, format: TableExportFormat | null, defaultLimit = 20) {
  if (format) return { page: 1, limit: EXPORT_ROW_CAP };
  return {
    page: Math.max(1, Number.parseInt(String(request.query.page ?? "1"), 10) || 1),
    limit: Math.min(100, Math.max(1, Number.parseInt(String(request.query.limit ?? String(defaultLimit)), 10) || defaultLimit))
  };
}

/** Human-readable filters for the export header, skipping the empty ones. */
export function describeFilters(entries: Record<string, unknown>) {
  return Object.entries(entries)
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "")
    .map(([label, value]) => ({ label, value: String(value) }));
}

/** Streams a finished export as a download. */
export async function sendTableExport<Row>(
  response: Response,
  format: TableExportFormat,
  input: TableExportInput<Row>
) {
  const body = format === "xlsx"
    ? await buildTableWorkbook(input)
    : await buildTablePdf(input);
  const { fileName, contentType } = exportFileMeta(input.title, format);

  response.setHeader("Content-Type", contentType);
  response.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  // The browser download is triggered from a fetch, so the filename has to be
  // readable by the script that saves it, not only by the browser.
  response.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
  response.setHeader("Content-Length", String(body.length));
  return response.status(200).send(body);
}
