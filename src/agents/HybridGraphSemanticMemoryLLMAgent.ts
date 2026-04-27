import { GraphBackedLLMAgent } from "./GraphMemoryLLMAgent.js"

export class HybridGraphSemanticMemoryLLMAgent extends GraphBackedLLMAgent {
  constructor() {
    super("HybridGraphSemanticMemoryLLMAgent", "hybrid")
  }
}
