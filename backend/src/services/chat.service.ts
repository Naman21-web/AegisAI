import agentService from "./agent.service.js";

class ChatService {
  async chat(
    message: string,
    threadId: string
  ) {
    return agentService.run(
      message,
      threadId
    );
  }
}

export default new ChatService();