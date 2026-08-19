import { Router } from "express";
import { chatController } from "../controllers/chat.controller.js";
import { asyncHandler } from "../utils/async-handler.js";

const router = Router();

router.post("/", asyncHandler(chatController));

export default router;