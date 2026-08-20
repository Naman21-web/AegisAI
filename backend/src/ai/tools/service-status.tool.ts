import { tool } from "@langchain/core/tools";
import { z } from "zod";

export const getServiceStatusTool = tool(
  async ({ service }) => {
    console.log(`🔧 Tool called: get_service_status(${service})`);

    const services: Record<string, {
      status: string;
      uptime: string;
      version: string;
    }> = {
      "payment-service": {
        status: "degraded",
        uptime: "99.82%",
        version: "v2.4.1",
      },

      "user-service": {
        status: "healthy",
        uptime: "99.99%",
        version: "v3.1.0",
      },

      "order-service": {
        status: "healthy",
        uptime: "99.97%",
        version: "v1.8.2",
      },
    };

    const result = services[service.toLowerCase()];

    if (!result) {
      return {
        service,
        status: "unknown",
        message: `No service information found for ${service}`,
      };
    }

    return {
      service,
      ...result,
    };
  },
  {
    name: "get_service_status",

    description:
      "Retrieve the current operational status, uptime, and deployed version of an engineering service. Use this whenever the user asks about the current status, health, uptime, availability, or version of a service.",

    schema: z.object({
      service: z
        .string()
        .describe("The exact engineering service name, e.g. payment-service"),
    }),
  }
);