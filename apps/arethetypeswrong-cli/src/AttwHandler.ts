import * as Config from 'effect/Config'
import * as Console from 'effect/Console'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import * as Argument from 'effect/unstable/cli/Argument'
import * as CliError from 'effect/unstable/cli/CliError'
import * as CliOutput from 'effect/unstable/cli/CliOutput'
import * as Command from 'effect/unstable/cli/Command'
import * as Flag from 'effect/unstable/cli/Flag'

import type { CliRequest } from './AttwExecutor.js'
import { runAttw } from './AttwExecutor.js'
import { failureOutcome } from './Failure.js'
import type { AttwFailure } from './Failure.schema.js'
import { CliFilesystem as Filesystem } from './FilesystemAdapter.js'
import { PackRunner } from './PackRunnerAdapter.js'
import { CliFormat, CliProfile } from './ProblemUtils.js'
import { schemaCommand } from './SchemaCommand.js'
import { Terminal } from './TerminalAdapter.js'

const defaultFormat: typeof CliFormat[number] = 'auto'
const defaultProfile: typeof CliProfile[number] = 'strict'

export const analyzeFlags = {
  'pack': Flag.boolean('pack').pipe(
    Flag.withAlias('P'),
    Flag.withDefault(false),
    Flag.withDescription(
      'Run `npm pack` in the specified directory and delete the resulting .tgz file afterwards',
    ),
  ),
  'from-npm': Flag.boolean('from-npm').pipe(
    Flag.withAlias('p'),
    Flag.withDefault(false),
    Flag.withDescription('Read from the npm registry instead of a local file'),
  ),
  'definitely-typed': Flag.optional(Flag.string('definitely-typed')).pipe(
    Flag.withDescription('Specify the version range of @types to use. Pass `false` to disable.'),
  ),
  'format': Flag.choice('format', CliFormat).pipe(
    Flag.withAlias('f'),
    Flag.withDefault(defaultFormat),
  ),
  'quiet': Flag.boolean('quiet').pipe(
    Flag.withAlias('q'),
    Flag.withDefault(false),
    Flag.withDescription("Don't print anything to STDOUT (overrides all other options)"),
  ),
  'entrypoints': Flag.optional(Flag.atLeast<string>(1)(Flag.string('entrypoints'))),
  'include-entrypoints': Flag.optional(Flag.atLeast<string>(1)(Flag.string('include-entrypoints'))),
  'exclude-entrypoints': Flag.optional(Flag.atLeast<string>(1)(Flag.string('exclude-entrypoints'))),
  'entrypoints-legacy': Flag.boolean('entrypoints-legacy').pipe(Flag.withDefault(false)),
  'ignore-rules': Flag.optional(
    Flag.atLeast<string>(1)(Flag.string('ignore-rules').pipe(Flag.withAlias('ignore-rule'))).pipe(
      Flag.withFallbackConfig(Config.schema(Config.Array(Schema.String), 'ignoreRules')),
    ),
  ),
  'profile': Flag.choice('profile', CliProfile).pipe(Flag.withDefault(defaultProfile)),
  'summary': Flag.boolean('summary').pipe(Flag.withDefault(true)),
  'emoji': Flag.boolean('emoji').pipe(Flag.withDefault(true)),
  'color': Flag.boolean('color').pipe(Flag.withDefault(true)),
  'registry': Flag.string('registry').pipe(
    Flag.withDescription(
      'URL of the npm registry to read packages from with --from-npm (default: https://registry.npmjs.org)',
    ),
    Flag.withFallbackConfig(
      Config.string('registry').pipe(Config.withDefault('https://registry.npmjs.org')),
    ),
  ),
} as const

const analyzeTarget = Argument.optional(Argument.string('file-directory-or-package-spec'))

const analyzeConfig = { ...analyzeFlags, target: analyzeTarget }

type AnalyzeConfig = Command.Command.Config.Infer<typeof analyzeConfig>

const unwrap = <A>(opt: Option.Option<A>): A | undefined => {
  if (Option.isSome(opt)) return opt.value
  return undefined
}

const analyzeHandler = (
  config: AnalyzeConfig,
): Effect.Effect<number, never, Terminal | Filesystem | PackRunner | Command.Environment> =>
  Effect.gen(function*() {
    const input: CliRequest = {
      fileOrDirectory: unwrap(config.target) ?? '.',
      pack: config['pack'],
      fromNpm: config['from-npm'],
      definitelyTyped: unwrap(config['definitely-typed']),
      format: config['format'],
      quiet: config['quiet'],
      entrypoints: unwrap(config['entrypoints']),
      includeEntrypoints: unwrap(config['include-entrypoints']),
      excludeEntrypoints: unwrap(config['exclude-entrypoints']),
      entrypointsLegacy: config['entrypoints-legacy'],
      ignoreRules: unwrap(config['ignore-rules']),
      profile: config['profile'],
      summary: config['summary'],
      emoji: config['emoji'],
      color: config['color'],
      registry: config['registry'],
    }
    const exitCode = yield* runAttw(input).pipe(Effect.catch(renderFailure))
    yield* Effect.sync(() => {
      process.exitCode = exitCode
    })
    return exitCode
  })

const analyzeCommand = Command.make('analyze', analyzeConfig, analyzeHandler)

export const attwCommand = Command.make('attw', analyzeConfig, analyzeHandler).pipe(
  Command.withSubcommands([analyzeCommand, schemaCommand]),
)

export const renderFailure = (failure: AttwFailure): Effect.Effect<number, never, Terminal> =>
  Effect.gen(function*() {
    const terminal = yield* Terminal
    const outcome = failureOutcome(failure, { isTty: terminal.isTty })
    yield* terminal.stderr.write(outcome.document)
    return outcome.exitCode
  })

const usageErrorFormatter = CliOutput.defaultFormatter({ colors: false })

const usageRecovery = 'Run `attw --help` to see the accepted commands and flags.'

export interface UsageErrorCommand {
  readonly kind: string
  readonly message: string
  readonly isTty: boolean
}

export interface UsageErrorOutcome {
  readonly document: string
  readonly exitCode: number
}

export const usageErrorOutcome = (command: UsageErrorCommand): UsageErrorOutcome => {
  if (command.isTty) return { document: `${command.message}. ${usageRecovery}\n`, exitCode: 1 }
  return {
    document: `${
      JSON.stringify({
        status: 'error',
        kind: command.kind,
        message: command.message,
        recovery: usageRecovery,
      })
    }\n`,
    exitCode: 1,
  }
}

const usageErrorCommandOf = (error: CliError.CliError, isTty: boolean): UsageErrorCommand => {
  if (!(error instanceof CliError.ShowHelp)) {
    return { kind: error._tag, message: usageErrorFormatter.formatCliError(error), isTty }
  }
  const [primary] = error.errors
  if (error.errors.length === 0) {
    return { kind: error._tag, message: error.message, isTty }
  }
  return {
    kind: primary._tag,
    message: error.errors.map((one) => usageErrorFormatter.formatCliError(one)).join('; '),
    isTty,
  }
}

export const renderCliError = (error: CliError.CliError): Effect.Effect<number, never, Terminal> =>
  Effect.gen(function*() {
    const terminal = yield* Terminal
    const outcome = usageErrorOutcome(usageErrorCommandOf(error, terminal.isTty))
    yield* terminal.stderr.write(outcome.document)
    return outcome.exitCode
  })

const writeCaptured = (
  stream: 'stdout' | 'stderr',
  captured: readonly string[],
): Effect.Effect<void, never, Terminal> =>
  Effect.gen(function*() {
    if (captured.length === 0) return
    const terminal = yield* Terminal
    const text = captured.map((line) => `${line}\n`).join('')
    if (stream === 'stdout') yield* terminal.stdout.write(text)
    else yield* terminal.stderr.write(text)
  })

const handleCliError = (
  error: CliError.CliError,
  captured: readonly string[],
): Effect.Effect<void, never, Terminal> =>
  Effect.gen(function*() {
    if (error instanceof CliError.ShowHelp && error.errors.length === 0) {
      yield* writeCaptured('stdout', captured)
      return
    }
    const exitCode = yield* renderCliError(error)
    yield* writeCaptured('stderr', captured)
    yield* Effect.sync(() => {
      process.exitCode = exitCode
    })
  })

const captureFrameworkLog = (captured: string[]): Console.Console =>
  new Proxy(globalThis.console, {
    get: (target, property) => {
      if (property === 'log') {
        return (...args: ReadonlyArray<unknown>): void => {
          captured.push(args.map(String).join(' '))
        }
      }
      const member: unknown = Reflect.get(target, property)
      return member
    },
  })

export const runCli = (
  argv: ReadonlyArray<string>,
  options: { readonly version: string },
): Effect.Effect<void, never, Terminal | Filesystem | PackRunner | Command.Environment> => {
  const captured: string[] = []
  return Command.runWith(attwCommand, { version: options.version, renderErrors: false })(argv).pipe(
    Effect.tap(() => writeCaptured('stdout', captured)),
    Effect.catchIf(CliError.isCliError, (error) => handleCliError(error, captured)),
    Effect.provideService(Console.Console, captureFrameworkLog(captured)),
  )
}
