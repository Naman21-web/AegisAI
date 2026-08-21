import { HumanMessage } from "@langchain/core/messages";
import { chatGraph } from "../ai/graphs/chat.graph.js";

class AgentService {
  async run(
    message: string,
    threadId: string
  ) {
    const result =
      await chatGraph.invoke(
        {
          userMessage: message,

          messages: [
            new HumanMessage(message),
          ],
        },

        {
          configurable: {
            thread_id: threadId,
          },
        }
      );

    return {
      intent: result.intent,
      answer: result.answer,
      confidence: result.confidence,
    };
  }
}

export default new AgentService();