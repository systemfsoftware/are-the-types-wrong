import { ConfigProvider, Effect, Layer, Match, Predicate } from 'effect'
import * as PlatformFs from 'effect/FileSystem'
import * as PlatformPathMod from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'

import {
  AttwConfigFileAbsentCommand,
  AttwConfigTextCommand,
  ConfigInvalid,
  loadAttwConfig,
  LoadAttwConfigCommand,
} from './load-attw-config.workflow.js'

const configFileName = '.attw.json'

const attwConfigUnreadable = (filePath: string): ConfigInvalid =>
  new ConfigInvalid({
    message: `The .attw.json at ${filePath} could not be read.`,
    recovery: 'Fix the file permissions or delete the file, then rerun the same command.',
  })

const configProviderEffect: Effect.Effect<
  ConfigProvider.ConfigProvider,
  ConfigInvalid,
  PlatformFs.FileSystem | PlatformPathMod.Path
> = Effect.gen(function*() {
  const fs = yield* PlatformFs.FileSystem
  const path = yield* PlatformPathMod.Path
  const filePath = path.join(process.cwd(), configFileName)
  const text = yield* fs.readFileString(filePath).pipe(
    Effect.catchIf(
      (error): error is PlatformError =>
        Predicate.isTagged(error, 'PlatformError') && Predicate.isTagged(error.reason, 'NotFound'),
      () => Effect.succeed(undefined),
    ),
    Effect.mapError(() => attwConfigUnreadable(filePath)),
  )
  let request: AttwConfigFileAbsentCommand | AttwConfigTextCommand
  if (text === undefined) {
    request = new AttwConfigFileAbsentCommand({ filePath })
  } else {
    request = new AttwConfigTextCommand({ text, filePath })
  }
  const decision = yield* Effect.fromResult(
    loadAttwConfig(new LoadAttwConfigCommand({ request })),
  )
  return ConfigProvider.fromUnknown(
    Match.value(decision).pipe(
      Match.tag('AttwConfigLoaded', ({ config }) => config),
      Match.tag('AttwConfigAbsent', () => ({})),
      Match.exhaustive,
    ),
  )
})

/**
 * The file's keys are read exactly as written. `constantCase` used to wrap this
 * provider, which rewrites the *lookup path* into `SCREAMING_SNAKE_CASE` to
 * bridge camelCase names to environment variables — so every camelCase key in a
 * `.attw.json` became unreachable, and the file was parsed and then ignored.
 *
 * `layerAdd` rather than `layer`, because `layer` replaces the provider
 * outright: the file would have silenced environment configuration instead of
 * supplying defaults beneath it.
 */
export const AttwConfigFileLayer: Layer.Layer<
  never,
  ConfigInvalid,
  PlatformFs.FileSystem | PlatformPathMod.Path
> = ConfigProvider.layerAdd(configProviderEffect)
