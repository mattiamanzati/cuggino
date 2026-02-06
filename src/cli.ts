#!/usr/bin/env node

import pkg from "../package.json" with { type: "json" }
import { Effect, Layer } from "effect"
import { Command } from "effect/unstable/cli"
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { ClaudeLlmAgentLayer } from "./ClaudeLlmAgent.js"
import { CodexLlmAgentLayer } from "./CodexLlmAgent.js"
import { StorageServiceLayer } from "./StorageService.js"
import { LoopServiceLayer } from "./LoopService.js"
import { WatchServiceLayer } from "./WatchService.js"
import { NotificationServiceLayer } from "./NotificationService.js"
import { SessionServiceMap } from "./SessionService.js"
import { root } from "./cli/command.js"

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

root.pipe(
  Command.provide((input) =>
    makeServicesLayer(input.agent === "codex" ? CodexLlmAgentLayer : ClaudeLlmAgentLayer)
  ),
  Command.run({ version: pkg.version }),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain
)
