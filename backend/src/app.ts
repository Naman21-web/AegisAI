import express from "express";
import cors from "cors";
import helmet from "helmet";

import chatRouter from "./routes/chat.routes.js";
import { notFoundHandler } from "./middleware/not-found.middleware.js";
import { errorHandler } from "./middleware/error.middleware.js";

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({
    success: true,
    service: "aegis-ai-api",
    status: "healthy",
  });
});

app.use("/api/v1/chat", chatRouter);

// 404 handler
app.use(notFoundHandler);

// MUST be the last middleware
app.use(errorHandler);

export default app;