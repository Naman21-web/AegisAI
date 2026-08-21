import {
  StateGraph,
  START,
  END,
} from "@langchain/langgraph";

import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

import { AgentState } from "../state/agent.state.js";

import { getServiceStatusTool } from "../tools/service-status.tool.js";
import { getRecentErrorsTool } from "../tools/recent-errors.tool.js";

import { plannerSchema } from "../schemas/planner.schema.js";

import { env } from "../../config/env.js";

// ============================================================
// 1. Gemini Models
// ============================================================

const model = new ChatGoogleGenerativeAI({
  model: "gemini-3.6-flash",
  temperature: 0.2,
  apiKey: env.GOOGLE_API_KEY,
});

// Planner uses structured output
const plannerModel =
  model.withStructuredOutput(
    plannerSchema
  );

// ============================================================
// 2. Tool Registry
// ============================================================

const toolRegistry = {
  get_service_status: getServiceStatusTool,
  get_recent_errors: getRecentErrorsTool,
};

// ============================================================
// 3. PLANNER
// ============================================================

async function createPlan(
  state: typeof AgentState.State
) {
  const plan =
    await plannerModel.invoke([
      {
        role: "system",

        content: `
You are the planning component of AegisAI.

Your job is to analyze the user's request and create
a structured execution plan.

DO NOT answer the user.

Available tools:

1. get_service_status

Purpose:
- current service status
- service health
- uptime
- availability
- deployed version

2. get_recent_errors

Purpose:
- recent errors
- exceptions
- failures
- troubleshooting
- investigating degraded services

Planning rules:

1. If the question can be answered without external
   information:

   requiresTools = false

   steps = []

2. If the user asks for current service status,
   use get_service_status.

3. If the user asks why a service is degraded,
   failing, or unhealthy:

   First:
   get_service_status

   Then:
   get_recent_errors

4. Do not invent tools.

5. Keep the plan minimal.

6. Arguments must contain the actual values extracted
   from the user's request.

Example:

User:
"What is the current status of payment-service?"

Plan:

{
  "intent": "check_service_status",
  "goal": "Determine the current status of payment-service",
  "requiresTools": true,
  "steps": [
    {
      "tool": "get_service_status",
      "reason": "Retrieve the current health of payment-service",
      "arguments": {
        "service": "payment-service"
      }
    }
  ]
}
`,
      },

      {
        role: "user",
        content: state.userMessage,
      },
    ]);

  console.log(
    "\n========== AGENT PLAN =========="
  );

  console.dir(plan, {
    depth: 10,
  });

  console.log(
    "================================\n"
  );

  return {
    plan,
    intent: plan.intent,
  };
}

// ============================================================
// 4. DETERMINISTIC TOOL EXECUTOR
// ============================================================

async function executePlan(
  state: typeof AgentState.State
) {
  const plan = state.plan as {
    intent: string;
    goal: string;
    requiresTools: boolean;
    steps: Array<{
      tool: string;
      reason: string;
      arguments: {
        service?: string;
        limit?: number;
      };
    }>;
  };

  // No tools required
  if (
    !plan ||
    !plan.requiresTools ||
    !plan.steps ||
    plan.steps.length === 0
  ) {
    return {
      toolResult: [],
    };
  }

  const results = [];

  for (const step of plan.steps) {
    console.log(
      `\n🔧 Executing planned tool: ${step.tool}`
    );

    console.log(
      "Arguments:",
      step.arguments
    );

    // ------------------------------------------
    // Security boundary:
    // Only tools explicitly registered above
    // can be executed.
    // ------------------------------------------

    const tool =
      toolRegistry[
        step.tool as keyof typeof toolRegistry
      ];

    if (!tool) {
      throw new Error(
        `Unknown tool requested by planner: ${step.tool}`
      );
    }

    try {
      const result =
        await tool.invoke(
          step.arguments
        );

      console.log(
        `✅ Tool completed: ${step.tool}`
      );

      results.push({
        tool: step.tool,
        arguments: step.arguments,
        result,
      });
    } catch (error) {
      console.error(
        `❌ Tool failed: ${step.tool}`,
        error
      );

      results.push({
        tool: step.tool,
        arguments: step.arguments,
        error:
          error instanceof Error
            ? error.message
            : "Unknown tool error",
      });
    }
  }

  console.log(
    "\n========== TOOL RESULTS =========="
  );

  console.dir(results, {
    depth: 10,
  });

  console.log(
    "==================================\n"
  );

  return {
    toolResult: results,
  };
}

// ============================================================
// 5. ANALYZER
// ============================================================

async function analyzeResults(
  state: typeof AgentState.State
) {
  const plan = state.plan as {
    intent: string;
    goal: string;
  };

  const toolResults =
    state.toolResult;

  const response =
    await model.invoke([
      {
        role: "system",

        content: `
You are AegisAI's analysis component.

Analyze the results collected by the tool executor
and answer the user's original question.

You are given:

1. User request
2. Agent plan
3. Tool results

Use ONLY the information available in the
tool results for operational claims.

If a tool failed, clearly mention that the
information could not be retrieved.

Do not invent metrics, errors, versions,
timestamps, or infrastructure details.

For troubleshooting questions:

- identify the important evidence
- explain the likely cause
- distinguish facts from inference
- provide practical next steps

Keep the answer concise but useful.

Do NOT call tools.
`,
      },

      {
        role: "user",

        content: `
Original user request:

${state.userMessage}

Agent intent:

${plan?.intent ?? "unknown"}

Agent goal:

${plan?.goal ?? "unknown"}

Tool results:

${JSON.stringify(
  toolResults,
  null,
  2
)}
`,
      },
    ]);

  console.log(
    "\n========== ANALYZER RESPONSE =========="
  );

  console.dir(response, {
    depth: 8,
  });

  console.log(
    "========================================\n"
  );

  return {
    answer:
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(
            response.content
          ),
  };
}

// ============================================================
// 6. DIRECT ANSWER
// ============================================================

async function generateDirectAnswer(
  state: typeof AgentState.State
) {
  const response =
    await model.invoke([
      {
        role: "system",

        content: `
You are AegisAI.

Answer the user's technical question directly.

No external tools are required for this request.

Do not claim to have retrieved live information.
`,
      },

      {
        role: "user",
        content: state.userMessage,
      },
    ]);

  return {
    answer:
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(
            response.content
          ),
  };
}

// ============================================================
// 7. DECIDE WHETHER TO EXECUTE TOOLS
// ============================================================

function shouldExecuteTools(
  state: typeof AgentState.State
) {
  const plan = state.plan as {
    requiresTools?: boolean;
  };

  if (plan?.requiresTools) {
    return "executePlan";
  }

  return "directAnswer";
}

// ============================================================
// 8. FINAL RESPONSE
// ============================================================

function buildFinalResponse(
  state: typeof AgentState.State
) {
  return {
    intent:
      state.intent ||
      "technical_question",

    answer:
      state.answer ||
      "I was unable to generate a response.",

    confidence: 0.95,
  };
}

// ============================================================
// 9. BUILD GRAPH
// ============================================================

const workflow =
  new StateGraph(AgentState)

    // -----------------------------
    // Planner
    // -----------------------------

    .addNode(
      "createPlan",
      createPlan
    )

    // -----------------------------
    // Deterministic executor
    // -----------------------------

    .addNode(
      "executePlan",
      executePlan
    )

    // -----------------------------
    // Analyze tool results
    // -----------------------------

    .addNode(
      "analyzeResults",
      analyzeResults
    )

    // -----------------------------
    // Direct answer
    // -----------------------------

    .addNode(
      "directAnswer",
      generateDirectAnswer
    )

    // -----------------------------
    // Final state
    // -----------------------------

    .addNode(
      "finalResponse",
      buildFinalResponse
    )

    // -----------------------------
    // START
    // -----------------------------

    .addEdge(
      START,
      "createPlan"
    )

    // -----------------------------
    // Planner decision
    // -----------------------------

    .addConditionalEdges(
      "createPlan",
      shouldExecuteTools,
      {
        executePlan:
          "executePlan",

        directAnswer:
          "directAnswer",
      }
    )

    // -----------------------------
    // Tool execution → Analyzer
    // -----------------------------

    .addEdge(
      "executePlan",
      "analyzeResults"
    )

    // -----------------------------
    // Analyzer → Final
    // -----------------------------

    .addEdge(
      "analyzeResults",
      "finalResponse"
    )

    // -----------------------------
    // Direct answer → Final
    // -----------------------------

    .addEdge(
      "directAnswer",
      "finalResponse"
    )

    // -----------------------------
    // Final → END
    // -----------------------------

    .addEdge(
      "finalResponse",
      END
    );

// ============================================================
// 10. Compile
// ============================================================

export const chatGraph =
  workflow.compile();