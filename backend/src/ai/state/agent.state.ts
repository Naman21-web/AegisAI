import { Annotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";

export const AgentState = Annotation.Root({
  userMessage: Annotation<string>({
    reducer: (_, value) => value,
    default: () => "",
  }),

  messages: Annotation<BaseMessage[]>({
    reducer: (current, update) => current.concat(update),
    default: () => [],
  }),

  intent: Annotation<string>({
    reducer: (_, value) => value,
    default: () => "",
  }),

  answer: Annotation<string>({
    reducer: (_, value) => value,
    default: () => "",
  }),

  confidence: Annotation<number>({
    reducer: (_, value) => value,
    default: () => 0,
  }),

  toolResult: Annotation<unknown>({
    reducer: (_, value) => value,
    default: () => null,
  }),
});