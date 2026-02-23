import { LayerMap } from "effect"
import { ClaudeLlmAgentLayer } from "./ClaudeLlmAgent.js"
import { CodexLlmAgentLayer } from "./CodexLlmAgent.js"
import { OpenCodeLlmAgentLayer } from "./OpenCodeLlmAgent.js"

export class AgentLayerMap extends LayerMap.Service<AgentLayerMap>()("AgentLayerMap", {
  lookup: (key: "claude" | "codex" | "opencode") =>
    key === "codex" ? CodexLlmAgentLayer : key === "opencode" ? OpenCodeLlmAgentLayer : ClaudeLlmAgentLayer
}) {}
