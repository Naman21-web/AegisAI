import { z } from "zod";

export const chatResponseSchema = z.object({
  intent: z.string(),
  answer: z.string(),
  confidence: z.number().min(0).max(1),
});

export type ChatResponse = z.infer<typeof chatResponseSchema>;