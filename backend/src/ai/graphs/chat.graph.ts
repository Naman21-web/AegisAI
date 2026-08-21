import {
  StateGraph,
  START,
  END,
} from "@langchain/langgraph";

import {
  ChatGoogleGenerativeAI,
} from "@langchain/google-genai";
import { MemorySaver } from "@langchain/langgraph";

import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";

import { AgentState } from "../state/agent.state.js";

import {
  getServiceStatusTool,
} from "../tools/service-status.tool.js";

import {
  getRecentErrorsTool,
} from "../tools/recent-errors.tool.js";

import { plannerSchema } from "../schemas/planner.schema.js";

import { env } from "../../config/env.js";

// ============================================================
// 1. GEMINI MODEL
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
// 2. TOOL REGISTRY
// ============================================================

const toolRegistry = {
  get_service_status:
    getServiceStatusTool,

  get_recent_errors:
    getRecentErrorsTool,
};

// ============================================================
// 3. HELPER
// ============================================================

function normalizeMessageContent(
  message: BaseMessage
): string {
  if (typeof message.content === "string") {
    return message.content;
  }

  return JSON.stringify(
    message.content
  );
}

// ============================================================
// 4. PLANNER
// ============================================================

async function createPlan(
  state: typeof AgentState.State
) {
  /*
   * We intentionally use:
   *
   * SystemMessage
   * followed by conversation messages.
   *
   * This prevents Gemini's:
   *
   * "System message should be the first one"
   *
   * error.
   */

  const conversationMessages =
    state.messages ?? [];

  const plan =
    await plannerModel.invoke([
      new SystemMessage(`
You are the planning component of AegisAI.

Your job is to analyze the user's request and create
a structured execution plan.

DO NOT answer the user.

You have access to the following tools.

--------------------------------------------------
AVAILABLE TOOLS
--------------------------------------------------

1. get_service_status

Purpose:
- current service status
- service health
- uptime
- availability
- deployed version

Arguments:

{
  "service": "service-name"
}

--------------------------------------------------

2. get_recent_errors

Purpose:
- recent errors
- exceptions
- failures
- troubleshooting
- investigating degraded services

Arguments:

{
  "service": "service-name",
  "limit": 5
}

--------------------------------------------------
PLANNING RULES
--------------------------------------------------

1. If the question can be answered without
   external information:

   requiresTools = false

   steps = []

2. If the user asks for current service status,
   use:

   get_service_status

3. If the user asks why a service is degraded,
   failing, unhealthy, or asks to troubleshoot it:

   First:

   get_service_status

   Then:

   get_recent_errors

4. Do not invent tools.

5. Keep the plan minimal.

6. Arguments must contain actual values extracted
   from the user's request or conversation history.

7. Use conversation history to resolve references such as:

   - "it"
   - "that service"
   - "the service"
   - "its version"
   - "its errors"
   - "what about it?"
   - "why is it failing?"

8. If a previous conversation message establishes
   the service name, reuse it when the current message
   uses a pronoun or implicit reference.

9. Do not answer the user.

10. Return ONLY the structured execution plan.

--------------------------------------------------
EXAMPLES
--------------------------------------------------

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
      "reason": "Retrieve the current health and status of payment-service",
      "arguments": {
        "service": "payment-service"
      }
    }
  ]
}

User:

"Why is payment-service degraded?"

Plan:

{
  "intent": "troubleshoot_degraded_service",
  "goal": "Investigate why payment-service is degraded",
  "requiresTools": true,
  "steps": [
    {
      "tool": "get_service_status",
      "reason": "Check the current health and status of payment-service",
      "arguments": {
        "service": "payment-service"
      }
    },
    {
      "tool": "get_recent_errors",
      "reason": "Retrieve recent errors from payment-service to identify the cause of degradation",
      "arguments": {
        "service": "payment-service",
        "limit": 5
      }
    }
  ]
}

User:

"What is a Redis distributed lock?"

Plan:

{
  "intent": "technical_question",
  "goal": "Explain Redis distributed locks",
  "requiresTools": false,
  "steps": []
}
`),

      /*
       * Conversation history comes after SystemMessage.
       *
       * This allows the planner to understand
       * references to previous turns.
       */

      ...conversationMessages,

      /*
       * Safety fallback:
       *
       * If messages somehow does not contain
       * the current user message, include it.
       */

      ...(conversationMessages.length === 0
        ? [
            new HumanMessage(
              state.userMessage
            ),
          ]
        : []),
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
// 5. DETERMINISTIC TOOL EXECUTOR
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

  /*
   * No tools required.
   */

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

  const results: any[] = [];

  /*
   * Execute tools sequentially.
   *
   * This is intentional because the planner
   * determines the execution order.
   */

  for (const step of plan.steps) {
    console.log(
      `\n🔧 Executing planned tool: ${step.tool}`
    );

    console.log(
      "Arguments:",
      step.arguments
    );

    /*
     * Security boundary:
     *
     * Only tools explicitly registered in
     * toolRegistry are allowed to execute.
     */

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

        arguments:
          step.arguments,

        result,
      });
    } catch (error) {
      console.error(
        `❌ Tool failed: ${step.tool}`,
        error
      );

      results.push({
        tool: step.tool,

        arguments:
          step.arguments,

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
// 6. ANALYZER
// ============================================================

async function analyzeResults(
  state: typeof AgentState.State
) {
  const plan = state.plan as {
    intent: string;
    goal: string;
  };

  const toolResults =
    state.toolResult ?? [];

  /*
   * We don't need the entire conversation for
   * operational evidence, but the latest conversation
   * context helps the analyzer understand references.
   */

  const conversationHistory =
    (state.messages ?? [])
      .map(
        (message) => {
          const role =
            message instanceof HumanMessage
              ? "User"
              : message instanceof AIMessage
              ? "Assistant"
              : "System";

          return `${role}: ${normalizeMessageContent(
            message
          )}`;
        }
      )
      .join("\n\n");

  const response =
    await model.invoke([
      new SystemMessage(`
You are AegisAI's analysis component.

Analyze the results collected by the tool executor
and answer the user's original question.

You are given:

1. Conversation history
2. User request
3. Agent plan
4. Tool results

--------------------------------------------------
IMPORTANT RULES
--------------------------------------------------

Use ONLY the information available in the
tool results for operational claims.

Do not invent:

- metrics
- errors
- versions
- timestamps
- infrastructure details
- service states
- logs

If a tool failed, clearly mention that
the information could not be retrieved.

For troubleshooting questions:

1. Identify important evidence.

2. Explain the likely cause.

3. Clearly distinguish:

   FACTS

   from

   INFERENCE

4. Provide practical next steps.

Do not claim that an external monitoring system
was accessed unless the tool result explicitly
provides that information.

Do not call tools.

Keep the answer concise but useful.
`),

      new HumanMessage(`
Conversation history:

${conversationHistory}

--------------------------------------------------

Original user request:

${state.userMessage}

--------------------------------------------------

Agent intent:

${plan?.intent ?? "unknown"}

--------------------------------------------------

Agent goal:

${plan?.goal ?? "unknown"}

--------------------------------------------------

Tool results:

${JSON.stringify(
  toolResults,
  null,
  2
)}
`),
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
// 7. DIRECT ANSWER
// ============================================================

async function generateDirectAnswer(
  state: typeof AgentState.State
) {
  const conversationHistory =
    (state.messages ?? [])
      .map(
        (message) => {
          const role =
            message instanceof HumanMessage
              ? "User"
              : message instanceof AIMessage
              ? "Assistant"
              : "System";

          return `${role}: ${normalizeMessageContent(
            message
          )}`;
        }
      )
      .join("\n\n");

  const response =
    await model.invoke([
      new SystemMessage(`
You are AegisAI.

Answer the user's technical question directly.

No external tools are required for this request.

You may use the conversation history to understand
follow-up questions and references.

Do not claim to have retrieved live information.

Do not invent real-time operational data.
`),

      new HumanMessage(`
Conversation history:

${conversationHistory}

--------------------------------------------------

Current user request:

${state.userMessage}
`),
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
// 8. DECIDE WHETHER TO EXECUTE TOOLS
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
// 9. FINAL RESPONSE
// ============================================================

function buildFinalResponse(
  state: typeof AgentState.State
) {
  const answer =
    state.answer ||
    "I was unable to generate a response.";

  /*
   * Persist assistant response in conversation
   * memory.
   *
   * Since agent.service.ts adds the current
   * HumanMessage and this node adds the AIMessage,
   * the checkpoint contains:
   *
   * HumanMessage
   * AIMessage
   * HumanMessage
   * AIMessage
   * ...
   */

  return {
    intent:
      state.intent ||
      "technical_question",

    answer,

    confidence: 0.95,

    messages: [
      new AIMessage(answer),
    ],
  };
}

// ============================================================
// 10. BUILD GRAPH
// ============================================================

const workflow =
  new StateGraph(AgentState)

    // --------------------------------------------------------
    // Planner
    // --------------------------------------------------------

    .addNode(
      "createPlan",
      createPlan
    )

    // --------------------------------------------------------
    // Deterministic tool executor
    // --------------------------------------------------------

    .addNode(
      "executePlan",
      executePlan
    )

    // --------------------------------------------------------
    // Analyzer
    // --------------------------------------------------------

    .addNode(
      "analyzeResults",
      analyzeResults
    )

    // --------------------------------------------------------
    // Direct answer
    // --------------------------------------------------------

    .addNode(
      "directAnswer",
      generateDirectAnswer
    )

    // --------------------------------------------------------
    // Final response
    // --------------------------------------------------------

    .addNode(
      "finalResponse",
      buildFinalResponse
    )

    // --------------------------------------------------------
    // START → Planner
    // --------------------------------------------------------

    .addEdge(
      START,
      "createPlan"
    )

    // --------------------------------------------------------
    // Planner decision
    // --------------------------------------------------------

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

    // --------------------------------------------------------
    // Tool execution → Analyzer
    // --------------------------------------------------------

    .addEdge(
      "executePlan",
      "analyzeResults"
    )

    // --------------------------------------------------------
    // Analyzer → Final
    // --------------------------------------------------------

    .addEdge(
      "analyzeResults",
      "finalResponse"
    )

    // --------------------------------------------------------
    // Direct answer → Final
    // --------------------------------------------------------

    .addEdge(
      "directAnswer",
      "finalResponse"
    )

    // --------------------------------------------------------
    // Final → END
    // --------------------------------------------------------

    .addEdge(
      "finalResponse",
      END
    );

// ============================================================
// 11. CHECKPOINTER
// ============================================================

const checkpointer = new MemorySaver();

// ============================================================
// 12. COMPILE GRAPH
// ============================================================

export const chatGraph =
  workflow.compile({
    checkpointer,
  });