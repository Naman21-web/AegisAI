import llmService from "./llm.service.js";

class ChatService {
  async chat(message: string) {
    const response = await llmService.generateResponse(message);

    return {
      message: response,
    };
  }
}

export default new ChatService();