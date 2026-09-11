import { ConfigProvider, Effect, Layer, Schema } from 'effect'
import * as PlatformFs from 'effect/FileSystem'
import * as PlatformPathMod from 'effect/Path'

const readAttwConfigJson: Effect.Effect<
  unknown,
  never,
  PlatformFs.FileSystem | PlatformPathMod.Path
> = Effect.gen(function*() {
  const fs = yield* PlatformFs.FileSystem
  const path = yield* PlatformPathMod.Path
  const cwd = process.cwd()
  for (const candidate of ['.attw.json', path.join(cwd, '.attw.json')]) {
    const text = yield* fs.readFileString(candidate).pipe(Effect.orElseSucceed(() => undefined))
    if (text === undefined) continue
    const parsed = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(text).pipe(
      Effect.orElseSucceed(() => undefined),
    )
    if (parsed === undefined) continue
    return parsed
  }
  return null
})

const configProviderEffect: Effect.Effect<
  ConfigProvider.ConfigProvider,
  never,
  PlatformFs.FileSystem | PlatformPathMod.Path
> = Effect.gen(function*() {
  const json = yield* readAttwConfigJson
  if (json === null) return ConfigProvider.fromUnknown({})
  return ConfigProvider.fromUnknown(json)
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
  never,
  PlatformFs.FileSystem | PlatformPathMod.Path
> = ConfigProvider.layerAdd(configProviderEffect)
