import { z } from "zod";

export const plannerSchema = z.object({
  intent: z.string(),

  goal: z.string(),

  requiresTools: z.boolean(),

  needsClarification: z.boolean(),

  clarificationQuestion: z.string(),

  steps: z.array(
    z.object({
      tool: z.string(),

      reason: z.string(),

      arguments: z.object({
        service: z.string().optional(),
        limit: z.number().optional(),
      }),
    })
  ),
});