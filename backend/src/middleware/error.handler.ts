import type {
  ErrorRequestHandler,
  NextFunction,
  Request,
  Response
} from "express";

export const notFoundHandler = (
  request: Request,
  response: Response
): void => {
  response.status(404).json({
    success: false,
    message: `Route not found: ${request.method} ${request.originalUrl}`
  });
};

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  _request: Request,
  response: Response,
  _next: NextFunction
): void => {
  console.error(error);

  response.status(500).json({
    success: false,
    message: "Internal server error"
  });
};