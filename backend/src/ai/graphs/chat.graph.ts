import {
  StateGraph,
  START,
  END,
} from "@langchain/langgraph";

import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

import { AgentState } from "../state/agent.state.js";

import { getServiceStatusTool } from "../tools/service-status.tool.js";
import { getRecentErrorsTool } from "../tools/recent-errors.tool.js";

import { plannerSchema } from "../schemas/planner.schema.js";

import { env } from "../../config/env.js";

// ============================================================
// 1. Initialize Gemini
// ============================================================

const model = new ChatGoogleGenerativeAI({
  model: "gemini-3.6-flash",
  temperature: 0.2,
  apiKey: env.GOOGLE_API_KEY,
});

// ============================================================
// 2. Planner Model
// ============================================================

const plannerModel =
  model.withStructuredOutput(
    plannerSchema
  );

// ============================================================
// 3. Register Tools
// ============================================================

const tools = [
  getServiceStatusTool,
  getRecentErrorsTool,
];

// Model gets access to tools
const modelWithTools =
  model.bindTools(tools);

// ToolNode executes tools
const toolNode =
  new ToolNode(tools);

// ============================================================
// 4. PLANNER NODE
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

Your job is to analyze the user's request and
create a structured execution plan.

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

Another example:

User:
"Why is payment-service degraded?"

Plan:

{
  "intent": "diagnose_service",
  "goal": "Determine why payment-service is degraded",
  "requiresTools": true,
  "steps": [
    {
      "tool": "get_service_status",
      "reason": "Confirm the current service health",
      "arguments": {
        "service": "payment-service"
      }
    },
    {
      "tool": "get_recent_errors",
      "reason": "Identify recent errors contributing to degradation",
      "arguments": {
        "service": "payment-service",
        "limit": 5
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
// 5. MODEL NODE
// ============================================================

async function callModel(
  state: typeof AgentState.State
) {
  const response =
    await modelWithTools.invoke([
      {
        role: "system",

        content: `
You are AegisAI, an engineering intelligence assistant.

You execute the execution plan created by the planner.

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

Rules:

1. Follow the execution plan.

2. Use the available tools when required.

3. Do not invent tools.

4. If multiple steps are present, execute the
   required tools and use their results together.

5. After receiving the tool results, provide a
   technically accurate final answer.

6. Do not claim that you lack access to monitoring
   systems when the available tools provide the
   requested information.

--------------------------------------------------

EXECUTION PLAN:

${JSON.stringify(
  state.plan,
  null,
  2
)}
`,
      },

      // User message MUST come after system message
      {
        role: "user",
        content: state.userMessage,
      },

      // Previous AI / Tool messages
      ...state.messages,
    ]);

  console.log(
    "\n========== MODEL RESPONSE =========="
  );

  console.dir(response, {
    depth: 8,
  });

  console.log(
    "====================================\n"
  );

  return {
    messages: [response],
  };
}

// ============================================================
// 6. DECIDE NEXT STEP AFTER MODEL
// ============================================================

function shouldContinue(
  state: typeof AgentState.State
) {
  const lastMessage =
    state.messages[
      state.messages.length - 1
    ];

  // Check if the model requested tools
  if (
    "tool_calls" in lastMessage &&
    Array.isArray(lastMessage.tool_calls) &&
    lastMessage.tool_calls.length > 0
  ) {
    return "tools";
  }

  // No tool calls means model produced
  // the final answer.
  return "finalResponse";
}

// ============================================================
// 7. FINAL RESPONSE NODE
// ============================================================

function extractFinalResponse(
  state: typeof AgentState.State
) {
  const lastMessage =
    state.messages[
      state.messages.length - 1
    ];

  let answer = "";

  if (
    typeof lastMessage.content === "string"
  ) {
    answer = lastMessage.content;
  } else {
    answer = JSON.stringify(
      lastMessage.content
    );
  }

  return {
    answer,

    // Intent comes from planner
    intent:
      state.intent ||
      "technical_question",

    // Temporary confidence.
    // We'll replace this with a proper
    // evaluation/confidence mechanism later.
    confidence: 0.95,
  };
}

// ============================================================
// 8. BUILD LANGGRAPH
// ============================================================

const workflow =
  new StateGraph(AgentState)

    // ----------------------------------------------
    // Planner
    // ----------------------------------------------

    .addNode(
      "createPlan",
      createPlan
    )

    // ----------------------------------------------
    // LLM / Agent
    // ----------------------------------------------

    .addNode(
      "callModel",
      callModel
    )

    // ----------------------------------------------
    // Tool execution
    // ----------------------------------------------

    .addNode(
      "tools",
      toolNode
    )

    // ----------------------------------------------
    // Final response
    // ----------------------------------------------

    .addNode(
      "finalResponse",
      extractFinalResponse
    )

    // ----------------------------------------------
    // START
    // ----------------------------------------------

    .addEdge(
      START,
      "createPlan"
    )

    // ----------------------------------------------
    // Planner → Model
    // ----------------------------------------------

    .addEdge(
      "createPlan",
      "callModel"
    )

    // ----------------------------------------------
    // Model → Tools OR Final Response
    // ----------------------------------------------

    .addConditionalEdges(
      "callModel",

      shouldContinue,

      {
        tools: "tools",
        finalResponse: "finalResponse",
      }
    )

    // ----------------------------------------------
    // Tool → Model
    // ----------------------------------------------

    .addEdge(
      "tools",
      "callModel"
    )

    // ----------------------------------------------
    // Final Response → END
    // ----------------------------------------------

    .addEdge(
      "finalResponse",
      END
    );

// ============================================================
// 9. Compile
// ============================================================

export const chatGraph =
  workflow.compile();