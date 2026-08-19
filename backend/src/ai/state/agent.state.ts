import { Annotation } from "@langchain/langgraph";

export const AgentState = Annotation.Root({
  userMessage: Annotation<string>({
    reducer: (_, value) => value,
    default: () => "",
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
});