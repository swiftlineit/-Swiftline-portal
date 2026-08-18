import { apiUrl } from "@/lib/api";
import { getAccessToken, refreshAccessToken } from "@/lib/auth";

/**
 * Downloading a table as a file.
 *
 * Exports come from the same endpoint as the table, with `format` added, so a
 * download always carries the filters the customer is looking at. It cannot be
 * a plain link: these endpoints need a bearer token, so the file is fetched and
 * handed to the browser as a blob.
 */
export type TableExportFormat = "xlsx" | "pdf";

/** Server-side row cap, mirrored so the UI can warn before it truncates. */
export const EXPORT_ROW_CAP = 10_000;

function fileNameFrom(header: string | null, fallback: string) {
  const match = header?.match(/filename="?([^"]+)"?/i);
  return match?.[1] ?? fallback;
}

/**
 * Fetches an export and saves it.
 *
 * Throws with the server's message when the request fails, so the caller can
 * toast it- a silent no-op on a clicked Download button is the worst outcome.
 */
export async function downloadTableExport(input: {
  /** The list endpoint path, without the format parameter. */
  path: string;
  params: URLSearchParams;
  format: TableExportFormat;
  /** Used only if the server sends no Content-Disposition. */
  fallbackName: string;
}) {
  let token = getAccessToken() ?? await refreshAccessToken();
  const params = new URLSearchParams(input.params);
  params.set("format", input.format);

  const send = () => fetch(apiUrl(`${input.path}?${params.toString()}`), {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined
  });

  let response = await send();
  if (response.status === 401) {
    token = await refreshAccessToken();
    if (token) response = await send();
  }

  if (!response.ok) {
    // A failed export still answers as JSON, so the real reason survives.
    const message = await response.json().then((body) => body?.message).catch(() => null);
    throw new Error(message || "The export could not be generated.");
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileNameFrom(
    response.headers.get("Content-Disposition"),
    `${input.fallbackName}.${input.format}`
  );
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
