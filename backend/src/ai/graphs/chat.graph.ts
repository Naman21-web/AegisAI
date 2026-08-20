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
import { env } from "../../config/env.js";

// --------------------------------------------------
// 1. Initialize model
// --------------------------------------------------

const model = new ChatGoogleGenerativeAI({
  model: "gemini-3.6-flash",
  temperature: 0.2,
  apiKey: env.GOOGLE_API_KEY,
});

// --------------------------------------------------
// 2. Register tools
// --------------------------------------------------

const tools = [
  getServiceStatusTool,
  getRecentErrorsTool,
];

const modelWithTools = model.bindTools(tools);

const toolNode = new ToolNode(tools);

// --------------------------------------------------
// 3. Call Model
// --------------------------------------------------

async function callModel(
  state: typeof AgentState.State
) {
  const response = await modelWithTools.invoke([
    {
      role: "system",
      content: `
You are AegisAI, an engineering intelligence assistant.

You help engineers troubleshoot systems, understand
technical concepts, and retrieve operational information.

Available tools:

1. get_service_status

Use this when the user asks for:
- current service status
- service health
- uptime
- availability
- deployed version

2. get_recent_errors

Use this when the user asks about:
- recent errors
- failures
- exceptions
- why a service is failing
- why a service is degraded
- troubleshooting a service

Important:

If the user asks why a service is degraded or failing,
you should first retrieve its current status and then
retrieve recent errors when necessary.

For general technical questions that don't require
external information, answer directly.

Do not claim that you lack access to monitoring systems
when the required tool is available.
`,
    },

    {
      role: "user",
      content: state.userMessage,
    },

    ...state.messages,
  ]);

  console.log("\n========== MODEL RESPONSE ==========");
  console.dir(response, { depth: 6 });
  console.log("====================================\n");

  return {
    messages: [response],
  };
}

// --------------------------------------------------
// 4. Decide whether tool execution is required
// --------------------------------------------------

function shouldContinue(
  state: typeof AgentState.State
) {
  const lastMessage =
    state.messages[state.messages.length - 1];

  if (
    "tool_calls" in lastMessage &&
    Array.isArray(lastMessage.tool_calls) &&
    lastMessage.tool_calls.length > 0
  ) {
    return "tools";
  }

  return "finalResponse";
}

// --------------------------------------------------
// 5. Extract final response
// --------------------------------------------------

function extractFinalResponse(
  state: typeof AgentState.State
) {
  const lastMessage =
    state.messages[state.messages.length - 1];

  const answer =
    typeof lastMessage.content === "string"
      ? lastMessage.content
      : JSON.stringify(lastMessage.content);

  return {
    intent: inferIntent(state.userMessage),
    answer,
    confidence: 0.95,
  };
}

// --------------------------------------------------
// 6. Simple intent detection
// --------------------------------------------------

function inferIntent(
  message: string
): string {
  const normalized =
    message.toLowerCase();

  if (
    normalized.includes("status") ||
    normalized.includes("health") ||
    normalized.includes("uptime") ||
    normalized.includes("availability")
  ) {
    return "check_service_status";
  }

  return "technical_question";
}

// --------------------------------------------------
// 7. Build Graph
// --------------------------------------------------

const workflow = new StateGraph(AgentState)

  // LLM reasoning / tool decision
  .addNode(
    "callModel",
    callModel
  )

  // Tool execution
  .addNode(
    "tools",
    toolNode
  )

  // Extract final answer
  .addNode(
    "finalResponse",
    extractFinalResponse
  )

  // START → LLM
  .addEdge(
    START,
    "callModel"
  )

  // LLM → Tool OR Final Response
  .addConditionalEdges(
    "callModel",
    shouldContinue,
    {
      tools: "tools",
      finalResponse: "finalResponse",
    }
  )

  // Tool → LLM
  .addEdge(
    "tools",
    "callModel"
  )

  // Final Response → END
  .addEdge(
    "finalResponse",
    END
  );

// --------------------------------------------------
// 8. Compile
// --------------------------------------------------

export const chatGraph =
  workflow.compile();