import { Request, Response } from "express";

export function notFoundHandler(
  req: Request,
  res: Response
) {
  return res.status(404).json({
    success: false,
    error: {
      code: "ROUTE_NOT_FOUND",
      message: `Route ${req.method} ${req.originalUrl} not found`,
    },
  });
}