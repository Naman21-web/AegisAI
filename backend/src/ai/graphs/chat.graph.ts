import {
  StateGraph,
  START,
  END,
  MemorySaver,
} from "@langchain/langgraph";

import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

import { AgentState } from "../state/agent.state.js";

import { getServiceStatusTool } from "../tools/service-status.tool.js";
import { getRecentErrorsTool } from "../tools/recent-errors.tool.js";

import { plannerSchema } from "../schemas/planner.schema.js";

import { env } from "../../config/env.js";


// ============================================================
// 1. GEMINI MODEL
// ============================================================

const model = new ChatGoogleGenerativeAI({
  model: "gemini-3.1-flash-lite",
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
  get_service_status: getServiceStatusTool,
  get_recent_errors: getRecentErrorsTool,
};


// ============================================================
// 3. PLANNER
// ============================================================

async function createPlan(
  state: typeof AgentState.State
) {

  console.log(
    "\n========== PLANNER CONTEXT =========="
  );

  console.log(
    "Current message:",
    state.userMessage
  );

  console.log(
    "Messages:",
    state.messages
  );

  console.log(
    "=====================================\n"
  );


  const conversationHistory =
    state.messages.length > 0
      ? state.messages
          .map((message) => {

            const type =
              message._getType();

            return `${type}: ${message.content}`;
          })
          .join("\n\n")
      : "(No previous conversation in this thread.)";


  const plan =
    await plannerModel.invoke([

      // ======================================================
      // SYSTEM
      // ======================================================

      {
        role: "system",

        content: `
You are the planning component of AegisAI.

Your job is to analyze the user's CURRENT request
and create a structured execution plan.

You MUST use the actual conversation history when
resolving references such as:

- "it"
- "this service"
- "that service"
- "those errors"
- "why is it failing?"

==================================================
AVAILABLE TOOLS
==================================================

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

==================================================
IMPORTANT ENTITY RESOLUTION RULES
==================================================

A service name may ONLY come from:

1. The current user request

OR

2. The ACTUAL conversation history supplied
to you.

Never obtain a service name from:

- examples in this system prompt
- tool descriptions
- hypothetical conversations
- your own assumptions
- common service names

The examples in this prompt are instructional only.
They are NOT conversation history.

If the user says:

"What errors are causing it?"

and there is NO service name in the current request
and NO service name in the actual conversation history:

DO NOT guess the service.

Set:

requiresTools = false

needsClarification = true

steps = []

and ask:

"Which service would you like me to check?"

==================================================
PLANNING RULES
==================================================

1. Current service status:

Use:

get_service_status

2. Recent errors:

Use:

get_recent_errors

3. Troubleshooting a degraded service:

Use:

get_service_status

Then:

get_recent_errors

4. If the user asks what errors are causing
a previously discussed service:

Resolve the service from the actual
conversation history.

5. If the service cannot be resolved:

Do NOT execute tools.

Set:

requiresTools = false

needsClarification = true

steps = []

6. If the question does not require tools:

requiresTools = false

needsClarification = false

steps = []

7. Do not invent tools.

8. Keep the plan minimal.

9. Arguments must contain values extracted
from the current request or actual conversation
history.

==================================================
IMPORTANT
==================================================

You are ONLY responsible for planning.

Do NOT answer the user's question.

Do NOT execute tools.

Do NOT invent missing entities.
`,
      },


      // ======================================================
      // USER
      // ======================================================

      {
        role: "user",

        content: `
ACTUAL CONVERSATION HISTORY
============================

${conversationHistory}

============================

CURRENT USER REQUEST
============================

${state.userMessage}

============================

Remember:

The conversation history above is the ONLY source
you may use to resolve references from previous
messages.
`,
      },
    ]);


  console.log(
    "\n========== AGENT PLAN =========="
  );

  console.dir(
    plan,
    {
      depth: 10,
    }
  );

  console.log(
    "================================\n"
  );


  return {

    plan,

    intent:
      plan.intent,

    needsClarification:
      plan.needsClarification,

    clarificationQuestion:
      plan.clarificationQuestion,
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

    needsClarification: boolean;

    steps: Array<{

      tool: string;

      reason: string;

      arguments: {

        service?: string;

        limit?: number;

      };

    }>;

  };


  // ----------------------------------------------------------
  // No tools required
  // ----------------------------------------------------------

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


  // ----------------------------------------------------------
  // Execute tools
  // ----------------------------------------------------------

  for (
    const step of plan.steps
  ) {

    console.log(
      `\n🔧 Executing planned tool: ${step.tool}`
    );

    console.log(
      "Arguments:",
      step.arguments
    );


    // --------------------------------------------------------
    // Security boundary
    // --------------------------------------------------------

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

  console.dir(
    results,
    {
      depth: 10,
    }
  );

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


  let responseInstructions = "";


  // ----------------------------------------------------------
  // SERVICE STATUS
  // ----------------------------------------------------------

  if (
    plan?.intent ===
    "check_service_status"
  ) {

    responseInstructions = `
The user asked for service status.

Give a concise answer.

Include only:

- service status
- uptime
- deployed version

Do NOT add troubleshooting analysis,
likely causes, or generic next steps.
`;
  }


  // ----------------------------------------------------------
  // RECENT ERRORS
  // ----------------------------------------------------------

  else if (
    plan?.intent ===
    "get_recent_errors"
  ) {

    responseInstructions = `
The user asked for recent errors.

Give a concise list.

For each error include:

- error name
- occurrence count
- timestamp

Do NOT provide root-cause analysis unless
the user explicitly asks for it.
`;
  }


  // ----------------------------------------------------------
  // TROUBLESHOOTING
  // ----------------------------------------------------------

  else if (

    plan?.intent ===
      "troubleshoot_degraded_service" ||

    plan?.intent ===
      "troubleshoot_service_errors"

  ) {

    responseInstructions = `
The user is troubleshooting a service.

Use exactly these sections:

### Evidence

List important facts returned by the tools.

### Likely Cause

Explain the likely cause based ONLY
on the retrieved evidence.

Clearly distinguish inference from fact.

Do NOT invent information.

### Next Steps

Provide 2-4 practical diagnostic steps.

If error results are empty:

- explicitly say that no recent errors
were returned
- say that available evidence is insufficient
to determine the root cause
- suggest additional information to retrieve
`;
  }


  // ----------------------------------------------------------
  // FALLBACK
  // ----------------------------------------------------------

  else {

    responseInstructions = `
Answer using only the available tool results.

Keep the answer concise.
`;
  }


  // ==========================================================
  // MODEL CALL
  // ==========================================================

  const response =
    await model.invoke([

      {
        role: "system",

        content: `
You are AegisAI's analysis component.

Analyze the tool results and answer the
user's CURRENT request.

Use ONLY information available in
the tool results for operational claims.

Never invent:

- metrics
- errors
- versions
- timestamps
- infrastructure
- dependencies
- deployment information

Do NOT call tools.

--------------------------------------------------

${responseInstructions}
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

  console.dir(
    response,
    {
      depth: 8,
    }
  );

  console.log(
    "========================================\n"
  );


  return {

    answer:
      typeof response.content ===
      "string"

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

Use the conversation history when necessary.

Do not claim to have retrieved live
information unless tools were actually used.

Keep the answer concise and useful.
`,
      },


      {
        role: "user",

        content: `
ACTUAL CONVERSATION HISTORY:

${state.messages
  .map((message) => {

    return `${message._getType()}: ${message.content}`;

  })
  .join("\n\n")}

--------------------------------------------

CURRENT USER REQUEST:

${state.userMessage}
`,
      },
    ]);


  return {

    answer:
      typeof response.content ===
      "string"

        ? response.content

        : JSON.stringify(
            response.content
          ),
  };
}


// ============================================================
// 7. CLARIFICATION
// ============================================================

async function clarification(
  state: typeof AgentState.State
) {

  const plan = state.plan as {

    clarificationQuestion?: string;

  };


  return {

    answer:
      plan?.clarificationQuestion ||
      "Which service would you like me to check?",

  };
}


// ============================================================
// 8. ROUTER
// ============================================================

function routeAfterPlanner(
  state: typeof AgentState.State
) {

  const plan = state.plan as {

    requiresTools?: boolean;

    needsClarification?: boolean;

  };


  // ----------------------------------------------------------
  // Missing entity / ambiguous request
  // ----------------------------------------------------------

  if (
    plan?.needsClarification
  ) {

    return "clarification";
  }


  // ----------------------------------------------------------
  // Tools required
  // ----------------------------------------------------------

  if (
    plan?.requiresTools
  ) {

    return "executePlan";
  }


  // ----------------------------------------------------------
  // No tools required
  // ----------------------------------------------------------

  return "directAnswer";
}


// ============================================================
// 9. FINAL RESPONSE
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

    confidence:
      0.95,

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
    // Tool executor
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
    // Clarification
    // --------------------------------------------------------

    .addNode(
      "clarification",
      clarification
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
    // Planner routing
    // --------------------------------------------------------

    .addConditionalEdges(

      "createPlan",

      routeAfterPlanner,

      {

        executePlan:
          "executePlan",

        directAnswer:
          "directAnswer",

        clarification:
          "clarification",

      }
    )


    // --------------------------------------------------------
    // Tools → Analyzer
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
    // Direct → Final
    // --------------------------------------------------------

    .addEdge(
      "directAnswer",
      "finalResponse"
    )


    // --------------------------------------------------------
    // Clarification → Final
    // --------------------------------------------------------

    .addEdge(
      "clarification",
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
// 11. MEMORY CHECKPOINT
// ============================================================

const checkpointer =
  new MemorySaver();


// ============================================================
// 12. COMPILE
// ============================================================

export const chatGraph =
  workflow.compile({
    checkpointer,
  });