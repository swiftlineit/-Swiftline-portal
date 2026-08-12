import type { Request, Response } from "express";
import { buildClientOverview } from "../services/clientOverview.service.js";
import { collectClientAttention } from "../services/clientAttention.service.js";
import { searchClientRecords } from "../services/clientSearch.service.js";
import { resolveClientScope } from "../utils/clientScope.js";

/** Every figure and list the client dashboard renders, in one call. */
export async function getClientOverview(request: Request, response: Response): Promise<Response> {
  const scope = await resolveClientScope(request);
  if (!scope.ok) {
    return response.status(scope.status).json({ success: false, message: scope.message });
  }

  const overview = await buildClientOverview(scope);
  return response.status(200).json({ success: true, ...overview });
}

/** The Exceptions centre. The same engine, without the dashboard's summary. */
export async function listClientExceptions(request: Request, response: Response): Promise<Response> {
  const scope = await resolveClientScope(request);
  if (!scope.ok) {
    return response.status(scope.status).json({ success: false, message: scope.message });
  }

  const { exceptions, exceptionCountsByType } = await collectClientAttention(scope);
  return response.status(200).json({ success: true, exceptions, exceptionCountsByType });
}

/** The Action Required page. */
export async function listClientActions(request: Request, response: Response): Promise<Response> {
  const scope = await resolveClientScope(request);
  if (!scope.ok) {
    return response.status(scope.status).json({ success: false, message: scope.message });
  }

  const { actions } = await collectClientAttention(scope);
  return response.status(200).json({ success: true, actions });
}

/** Global search, across every kind of record a customer holds a number for. */
export async function searchClient(request: Request, response: Response): Promise<Response> {
  const scope = await resolveClientScope(request);
  if (!scope.ok) {
    return response.status(scope.status).json({ success: false, message: scope.message });
  }

  const term = typeof request.query.q === "string" ? request.query.q : "";
  // Long enough to be a pasted identifier, short enough that nobody is probing
  // with a payload.
  if (term.length > 80) {
    return response.status(400).json({ success: false, message: "Search term is too long." });
  }

  const results = await searchClientRecords({ ...scope, term });
  return response.status(200).json({ success: true, results });
}
