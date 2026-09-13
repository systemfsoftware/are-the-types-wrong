#!/usr/bin/env node
import { layer as nodeChildProcessSpawnerLayer } from '@effect/platform-node-shared/NodeChildProcessSpawner'
import { layer as nodeFileSystemLayer } from '@effect/platform-node-shared/NodeFileSystem'
import { layer as nodePathLayer } from '@effect/platform-node-shared/NodePath'
import { layer as nodeStdioLayer } from '@effect/platform-node-shared/NodeStdio'
import { layer as nodeTerminalLayer } from '@effect/platform-node-shared/NodeTerminal'
import { runMain } from '@effect/platform-node/NodeRuntime'
import { Effect, Layer } from 'effect'
import { layer as cliConfigLayerFactory } from 'effect/unstable/cli/CliConfig'

import { AttwConfigFileLayer } from './AttwConfigExecutor.js'
import { renderFailure, runCli } from './AttwHandler.js'
import { cliVersion } from './cli-version.js'
import { FilesystemLive } from './FilesystemAdapter.js'
import { PackRunnerLive } from './PackRunnerAdapter.js'
import { TerminalLive } from './TerminalAdapter.js'

const cliConfigLayer = Layer.provideMerge(cliConfigLayerFactory(), AttwConfigFileLayer)

const main = runCli(process.argv.slice(2), { version: cliVersion })

const cliLayer = Layer.mergeAll(TerminalLive, FilesystemLive)

const nodeBase = Layer.mergeAll(nodeFileSystemLayer, nodePathLayer, nodeTerminalLayer, nodeStdioLayer)
const nodeSpawnerLayer = nodeChildProcessSpawnerLayer.pipe(Layer.provide(nodeBase))

const nodeRuntime = Layer.mergeAll(
  nodeBase,
  nodeSpawnerLayer,
  PackRunnerLive.pipe(Layer.provide(nodeSpawnerLayer)),
)

const terminalLayer = Layer.provideMerge(TerminalLive, nodeBase)

const program = main.pipe(
  Effect.withLogSpan('attw'),
)

const provided = program.pipe(
  Effect.provide(Layer.provideMerge(Layer.mergeAll(cliLayer, cliConfigLayer), nodeRuntime)),
)

const handled = provided.pipe(
  Effect.catchTag('ConfigInvalid', (failure) =>
    Effect.gen(function*() {
      const exitCode = yield* renderFailure(failure)
      yield* Effect.sync(() => {
        process.exitCode = exitCode
      })
    }).pipe(Effect.provide(terminalLayer))),
)

runMain(handled)
