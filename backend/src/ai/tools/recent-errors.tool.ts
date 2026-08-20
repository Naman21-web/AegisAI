import { tool } from "@langchain/core/tools";
import { z } from "zod";

export const getRecentErrorsTool = tool(
  async ({ service, limit }) => {
    console.log(
      `🔧 Tool called: get_recent_errors(${service}, limit=${limit})`
    );

    // Simulated log/observability data.
    // Later we'll replace this with a real API.
    const errors: Record<
      string,
      Array<{
        timestamp: string;
        error: string;
        count: number;
      }>
    > = {
      "payment-service": [
        {
          timestamp: "2026-08-19T12:10:00Z",
          error: "PaymentGatewayTimeout",
          count: 37,
        },
        {
          timestamp: "2026-08-19T12:05:00Z",
          error: "ConnectionPoolExhausted",
          count: 12,
        },
        {
          timestamp: "2026-08-19T11:58:00Z",
          error: "PaymentProviderUnavailable",
          count: 8,
        },
      ],

      "user-service": [
        {
          timestamp: "2026-08-19T11:45:00Z",
          error: "DatabaseQueryTimeout",
          count: 3,
        },
      ],

      "order-service": [
        {
          timestamp: "2026-08-19T10:30:00Z",
          error: "InventoryServiceTimeout",
          count: 2,
        },
      ],
    };

    const serviceErrors =
      errors[service.toLowerCase()] ?? [];

    return {
      service,
      errors: serviceErrors.slice(0, limit),
    };
  },
  {
    name: "get_recent_errors",

    description:
      "Retrieve recent application errors for an engineering service. Use this when investigating why a service is degraded, failing, timing out, or experiencing errors.",

    schema: z.object({
      service: z
        .string()
        .describe(
          "The exact engineering service name, e.g. payment-service"
        ),

      limit: z
        .number()
        .int()
        .min(1)
        .max(10)
        .default(5)
        .describe(
          "Maximum number of recent errors to retrieve"
        ),
    }),
  }
);