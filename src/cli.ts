#!/usr/bin/env node

import { Effect, Layer } from "effect"
import { Command } from "effect/unstable/cli"
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { ClaudeLlmAgentLayer } from "./ClaudeLlmAgent.js"
import { StorageServiceLayer } from "./StorageService.js"
import { LoopServiceLayer } from "./LoopService.js"
import { WatchServiceLayer } from "./WatchService.js"
import { SessionServiceMap } from "./SessionService.js"
import { root } from "./cli/command.js"

const baseServicesLayer = LoopServiceLayer.pipe(
  Layer.provideMerge(ClaudeLlmAgentLayer),
  Layer.provideMerge(SessionServiceMap.layer),
  Layer.provideMerge(StorageServiceLayer(process.cwd())),
  Layer.provideMerge(NodeServices.layer)
)

const servicesLayer = WatchServiceLayer.pipe(
  Layer.provideMerge(baseServicesLayer)
)

root.pipe(
  Command.run({ version: "0.0.1" }),
  Effect.provide(servicesLayer),
  NodeRuntime.runMain
)
