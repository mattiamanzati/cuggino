#!/usr/bin/env node

import pkg from "../package.json" with { type: "json" }
import { Effect } from "effect"
import { Command } from "effect/unstable/cli"
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { AgentLayerMap } from "./AgentLayerMap.js"
import { root } from "./cli/command.js"

root.pipe(
  Command.provide(AgentLayerMap.layer),
  Command.run({ version: pkg.version }),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain
)
