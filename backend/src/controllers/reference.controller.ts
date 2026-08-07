import type { Request, Response } from "express";
import {
  GeographyDataError,
  getCities,
  getStates
} from "../services/reference/geography.service.js";
import { HsCodeDataError, searchHsCodes } from "../services/reference/hsCode.service.js";

// Geography never changes between deploys, so let the browser and any proxy
// hold it rather than asking again on every form open.
const cacheHeader = "public, max-age=86400, stale-while-revalidate=604800";

function handleGeographyError(error: unknown, response: Response) {
  if (error instanceof GeographyDataError) {
    return response.status(error.statusCode).json({ success: false, message: error.message });
  }

  throw error;
}

export async function listStates(request: Request, response: Response): Promise<Response> {
  try {
    const states = getStates(String(request.params.countryCode ?? ""));

    response.setHeader("Cache-Control", cacheHeader);
    return response.status(200).json({ success: true, states });
  } catch (error) {
    return handleGeographyError(error, response);
  }
}

export async function suggestHsCodes(request: Request, response: Response): Promise<Response> {
  const query = typeof request.query.query === "string" ? request.query.query : "";

  try {
    const suggestions = searchHsCodes(query);

    response.setHeader("Cache-Control", cacheHeader);
    return response.status(200).json({ success: true, suggestions });
  } catch (error) {
    if (error instanceof HsCodeDataError) {
      return response.status(error.statusCode).json({ success: false, message: error.message });
    }

    throw error;
  }
}

export async function listCities(request: Request, response: Response): Promise<Response> {
  try {
    const cities = getCities(
      String(request.params.countryCode ?? ""),
      String(request.params.stateCode ?? "")
    );

    response.setHeader("Cache-Control", cacheHeader);
    return response.status(200).json({ success: true, cities });
  } catch (error) {
    return handleGeographyError(error, response);
  }
}
