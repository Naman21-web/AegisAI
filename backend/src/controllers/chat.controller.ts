import { Request, Response } from "express";
import chatService from "../services/chat.service.js";
import { AppError } from "../utils/app-error.js";

export async function chatController(
  req: Request,
  res: Response
) {
  const { message } = req.body;

  if (!message || typeof message !== "string") {
    throw new AppError(
      "message is required",
      400,
      "INVALID_REQUEST"
    );
  }

  const result = await chatService.chat(message);

  return res.status(200).json({
    success: true,
    data: result,
  });
}