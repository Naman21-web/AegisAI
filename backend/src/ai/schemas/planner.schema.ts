import { z } from "zod";

export const plannerSchema = z.object({
  intent: z
    .string()
    .describe("The user's primary intent"),

  goal: z
    .string()
    .describe(
      "What the agent needs to accomplish for the user"
    ),

  requiresTools: z
    .boolean()
    .describe(
      "Whether external tools are required"
    ),

  steps: z.array(
    z.object({
      tool: z
        .enum([
          "get_service_status",
          "get_recent_errors",
        ])
        .describe(
          "The tool that should be executed"
        ),

      reason: z
        .string()
        .describe(
          "Why this tool is needed"
        ),

      arguments: z
        .object({
          service: z
            .string()
            .optional()
            .describe(
              "The service name, for example payment-service"
            ),

          limit: z
            .number()
            .int()
            .min(1)
            .max(10)
            .optional()
            .describe(
              "Maximum number of errors to retrieve"
            ),
        })
        .describe(
          "Arguments required by the selected tool"
        ),
    })
  ),
});

export type PlannerOutput =
  z.infer<typeof plannerSchema>;