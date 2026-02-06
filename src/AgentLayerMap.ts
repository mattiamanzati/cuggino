import { Layer, LayerMap } from "effect"
import { NodeServices } from "@effect/platform-node"
import { ClaudeLlmAgentLayer } from "./ClaudeLlmAgent.js"
import { CodexLlmAgentLayer } from "./CodexLlmAgent.js"
import { StorageServiceLayer } from "./StorageService.js"
import { LoopServiceLayer } from "./LoopService.js"
import { WatchServiceLayer } from "./WatchService.js"
import { NotificationServiceLayer } from "./NotificationService.js"
import { SessionServiceMap } from "./SessionService.js"

const makeServicesLayer = (agentLayer: typeof ClaudeLlmAgentLayer) => {
  const baseServicesLayer = LoopServiceLayer.pipe(
    Layer.provideMerge(agentLayer),
    Layer.provideMerge(SessionServiceMap.layer),
    Layer.provideMerge(StorageServiceLayer(process.cwd())),
    Layer.provideMerge(NodeServices.layer)
  )

  return WatchServiceLayer.pipe(
    Layer.provideMerge(NotificationServiceLayer(process.cwd())),
    Layer.provideMerge(baseServicesLayer)
  )
}

export class AgentLayerMap extends LayerMap.Service<AgentLayerMap>()("AgentLayerMap", {
  lookup: (key: "claude" | "codex") =>
    makeServicesLayer(key === "codex" ? CodexLlmAgentLayer : ClaudeLlmAgentLayer)
}) {}
