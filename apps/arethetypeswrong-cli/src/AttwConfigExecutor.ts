import { ConfigProvider, Effect, Layer, Predicate } from 'effect'
import * as PlatformFs from 'effect/FileSystem'
import * as PlatformPathMod from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'

import { attwConfigUnreadable, decodeAttwConfigText } from './AttwConfig.js'
import type { ConfigInvalid } from './Failure.schema.js'

const configFileName = '.attw.json'

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
  if (text === undefined) return ConfigProvider.fromUnknown({})
  return ConfigProvider.fromUnknown(yield* Effect.fromResult(decodeAttwConfigText(text, filePath)))
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
