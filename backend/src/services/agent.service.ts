import { chatGraph } from "../ai/graphs/chat.graph.js";

class AgentService {
  async run(message: string) {
    const result = await chatGraph.invoke({
      userMessage: message,
    });

    return {
      intent: result.intent,
      answer: result.answer,
      confidence: result.confidence,
    };
  }
}

export default new AgentService();