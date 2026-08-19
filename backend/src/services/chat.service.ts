import agentService from "./agent.service.js";

class ChatService {
  async chat(message: string) {
    return agentService.run(message);
  }
}

export default new ChatService();