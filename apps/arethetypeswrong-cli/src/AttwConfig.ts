import { Result, Schema } from 'effect'

import { type AttwConfig, AttwConfigSchema } from './AttwConfig.schema.js'
import { ConfigInvalid } from './Failure.schema.js'

const acceptedKeys =
  'ignoreRules, ignoreResolutions, format, quiet, summary, emoji, color, entrypoints, includeEntrypoints, excludeEntrypoints, entrypointsLegacy, fromNpm, pack, registry'

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim()

const configInvalid = (filePath: string, issue: string): ConfigInvalid =>
  new ConfigInvalid({
    message: `The .attw.json at ${filePath} is invalid: ${issue}`,
    recovery: `Fix the file or delete it, then rerun the same command. Accepted keys: ${acceptedKeys}.`,
  })

export const attwConfigUnreadable = (filePath: string): ConfigInvalid =>
  new ConfigInvalid({
    message: `The .attw.json at ${filePath} could not be read.`,
    recovery: 'Fix the file permissions or delete the file, then rerun the same command.',
  })

export const decodeAttwConfigText = (
  text: string,
  filePath: string,
): Result.Result<AttwConfig, ConfigInvalid> =>
  Result.mapError(
    Schema.decodeUnknownResult(Schema.fromJsonString(AttwConfigSchema))(text),
    (error) => configInvalid(filePath, oneLine(error.message)),
  )
