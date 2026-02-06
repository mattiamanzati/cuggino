import { LayerMap } from "effect"
import { ClaudeLlmAgentLayer } from "./ClaudeLlmAgent.js"
import { CodexLlmAgentLayer } from "./CodexLlmAgent.js"

export class AgentLayerMap extends LayerMap.Service<AgentLayerMap>()("AgentLayerMap", {
  lookup: (key: "claude" | "codex") =>
    key === "codex" ? CodexLlmAgentLayer : ClaudeLlmAgentLayer
}) {}
