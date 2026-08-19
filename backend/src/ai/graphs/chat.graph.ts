import {
  StateGraph,
  START,
  END,
} from "@langchain/langgraph";

import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

import { AgentState } from "../state/agent.state.js";
import { chatResponseSchema } from "../schemas/chat.schema.js";
import { env } from "../../config/env.js";

const model = new ChatGoogleGenerativeAI({
  model: "gemini-3.6-flash",
  temperature: 0.2,
  apiKey: env.GOOGLE_API_KEY,
});

const structuredModel =
  model.withStructuredOutput(chatResponseSchema);

async function generateResponse(
  state: typeof AgentState.State
) {
  const result = await structuredModel.invoke([
    {
      role: "system",
      content: `
You are AegisAI, an engineering intelligence assistant.

Analyze the user's request and:

1. Identify the intent.
2. Provide a technically accurate answer.
3. Give a confidence score between 0 and 1.

Return only the requested structured output.
`,
    },
    {
      role: "user",
      content: state.userMessage,
    },
  ]);

  return {
    intent: result.intent,
    answer: result.answer,
    confidence: result.confidence,
  };
}

const workflow = new StateGraph(AgentState)
  .addNode("generateResponse", generateResponse)
  .addEdge(START, "generateResponse")
  .addEdge("generateResponse", END);

export const chatGraph = workflow.compile();