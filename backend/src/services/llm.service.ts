import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { env } from "../config/env.js";

class LLMService {
  private model: ChatGoogleGenerativeAI;

  constructor() {
    this.model = new ChatGoogleGenerativeAI({
      model: "gemini-3.6-flash",
      temperature: 0.2,
      apiKey: env.GOOGLE_API_KEY,
    });
  }

  async generateResponse(message: string) {
    const response = await this.model.invoke([
      {
        role: "system",
        content:
          "You are AegisAI, an engineering intelligence assistant. Give concise, technically accurate responses.",
      },
      {
        role: "user",
        content: message,
      },
    ]);

    return response.content;
  }
}

export default new LLMService();