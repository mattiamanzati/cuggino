#!/usr/bin/env node

import pkg from "../package.json" with { type: "json" }
import { Effect, Layer } from "effect"
import { Command } from "effect/unstable/cli"
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { AgentLayerMap } from "./AgentLayerMap.js"
import { root } from "./cli/command.js"
import { StorageServiceLayer } from "./StorageService.js"
import { NotificationServiceLayer } from "./NotificationService.js"
import { SessionServiceMap } from "./SessionService.js"

const sharedLayer = NotificationServiceLayer(process.cwd()).pipe(
  Layer.provideMerge(SessionServiceMap.layer),
  Layer.provideMerge(StorageServiceLayer(process.cwd())),
  Layer.provideMerge(NodeServices.layer)
)

root.pipe(
  Command.provide(sharedLayer),
  Command.provide(AgentLayerMap.layer),
  Command.run({ version: pkg.version }),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain
)
