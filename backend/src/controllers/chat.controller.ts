import { Request, Response } from "express";

import chatService from "../services/chat.service.js";

export async function chatController(
  req: Request,
  res: Response
) {
  const {
    message,
    threadId,
  } = req.body;

  if (
    typeof message !== "string" ||
    !message.trim()
  ) {
    return res.status(400).json({
      success: false,
      message: "message is required",
    });
  }

  if (
    typeof threadId !== "string" ||
    !threadId.trim()
  ) {
    return res.status(400).json({
      success: false,
      message: "threadId is required",
    });
  }

  const result = await chatService.chat(
    message.trim(),
    threadId.trim()
  );

  return res.status(200).json({
    success: true,
    data: result,
  });
}