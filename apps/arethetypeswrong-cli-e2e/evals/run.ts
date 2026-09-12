import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const evalsDir = import.meta.dirname
const defaultBinaryPath = resolve(evalsDir, '../../arethetypeswrong-cli/dist/main.mjs')
const transcriptsDir = resolve(evalsDir, 'transcripts')
const baselinePath = resolve(evalsDir, 'baseline.json')
const binaryPath = resolve(process.argv[2] ?? defaultBinaryPath)
const invocationTimeoutMs = 60_000
const maxBufferBytes = 32 * 1024 * 1024

interface EqualityCheck {
  readonly path: string
  readonly expected: unknown
}

interface StreamExpectation {
  readonly empty: boolean | undefined
  readonly json: boolean | undefined
  readonly contains: readonly string[] | undefined
  readonly equals: readonly EqualityCheck[] | undefined
  readonly present: readonly string[] | undefined
  readonly absent: readonly string[] | undefined
}

interface InvocationExpectation {
  readonly exitCode: number
  readonly stdout: StreamExpectation
  readonly stderr: StreamExpectation
}

interface Invocation {
  readonly argv: readonly string[]
  readonly baseline: string | null
  readonly expect: InvocationExpectation
}

interface Transcript {
  readonly pattern: string
  readonly lesson: string
  readonly invocations: readonly Invocation[]
}

interface BaselineRow {
  readonly invocation: string
  readonly stdoutBytes: number
  readonly stderrBytes: number
  readonly exitCode: number
}

interface StreamResult {
  readonly bytes: number
  readonly text: string
}

interface InvocationResult {
  readonly exitCode: number
  readonly stdout: StreamResult
  readonly stderr: StreamResult
  readonly spawnError: string | undefined
}

interface Row {
  readonly label: string
  readonly passed: boolean
  readonly exitCode: number
  readonly stdoutBytes: number
  readonly stderrBytes: number
  readonly deltaStdout: number | undefined
  readonly deltaStderr: number | undefined
}

const report = (line: string): void => {
  process.stdout.write(`${line}\n`)
}

const reportFailure = (line: string): void => {
  process.stderr.write(`${line}\n`)
}

const requireObjectValue = (value: unknown, where: string): object => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${where}: expected an object`)
  }
  return value
}

const propertyOf = (value: unknown, key: string, where: string): unknown =>
  Object.getOwnPropertyDescriptor(requireObjectValue(value, where), key)?.value

const readString = (value: unknown, where: string): string => {
  if (typeof value !== 'string') throw new Error(`${where}: expected a string`)
  return value
}

const readNumber = (value: unknown, where: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${where}: expected a finite number`)
  return value
}

const readBoolean = (value: unknown, where: string): boolean => {
  if (typeof value !== 'boolean') throw new Error(`${where}: expected a boolean`)
  return value
}

const readStringArray = (value: unknown, where: string): readonly string[] => {
  if (!Array.isArray(value)) throw new Error(`${where}: expected an array of strings`)
  for (const entry of value) {
    if (typeof entry !== 'string') throw new Error(`${where}: expected an array of strings`)
  }
  return value
}

const readArray = (value: unknown, where: string): readonly unknown[] => {
  if (!Array.isArray(value)) throw new Error(`${where}: expected an array`)
  return value
}

const readNullableString = (value: unknown, where: string): string | null => {
  if (value === null) return null
  return readString(value, where)
}

const readEqualityChecks = (value: unknown, where: string): readonly EqualityCheck[] =>
  Object.entries(requireObjectValue(value, where)).map(([path, expected]) => ({ path, expected }))

const readField = <A>(
  object: unknown,
  key: string,
  read: (value: unknown, where: string) => A,
  where: string,
): A => {
  const value = propertyOf(object, key, where)
  if (value === undefined) throw new Error(`${where}.${key}: missing`)
  return read(value, `${where}.${key}`)
}

const readOptionalField = <A>(
  object: unknown,
  key: string,
  read: (value: unknown, where: string) => A,
  where: string,
): A | undefined => {
  const value = propertyOf(object, key, where)
  if (value === undefined) return undefined
  return read(value, `${where}.${key}`)
}

const emptyStreamExpectation: StreamExpectation = {
  empty: undefined,
  json: undefined,
  contains: undefined,
  equals: undefined,
  present: undefined,
  absent: undefined,
}

const readStreamExpectation = (value: unknown, where: string): StreamExpectation => ({
  empty: readOptionalField(value, 'empty', readBoolean, where),
  json: readOptionalField(value, 'json', readBoolean, where),
  contains: readOptionalField(value, 'contains', readStringArray, where),
  equals: readOptionalField(value, 'equals', readEqualityChecks, where),
  present: readOptionalField(value, 'present', readStringArray, where),
  absent: readOptionalField(value, 'absent', readStringArray, where),
})

const readStreamExpectationField = (object: unknown, key: string, where: string): StreamExpectation => {
  const value = propertyOf(object, key, where)
  if (value === undefined) return emptyStreamExpectation
  return readStreamExpectation(value, `${where}.${key}`)
}

const readInvocation = (value: unknown, where: string): Invocation => {
  const expect = propertyOf(value, 'expect', where)
  const expectWhere = `${where}.expect`
  return {
    argv: readField(value, 'argv', readStringArray, where),
    baseline: readField(value, 'baseline', readNullableString, where),
    expect: {
      exitCode: readField(expect, 'exitCode', readNumber, expectWhere),
      stdout: readStreamExpectationField(expect, 'stdout', expectWhere),
      stderr: readStreamExpectationField(expect, 'stderr', expectWhere),
    },
  }
}

const readTranscript = (value: unknown, where: string): Transcript => {
  const invocationsWhere = `${where}.invocations`
  const entries = readArray(propertyOf(value, 'invocations', where), invocationsWhere)
  if (entries.length === 0) throw new Error(`${invocationsWhere}: needs at least one invocation`)
  return {
    pattern: readField(value, 'pattern', readString, where),
    lesson: readField(value, 'lesson', readString, where),
    invocations: entries.map((entry, index) => readInvocation(entry, `${invocationsWhere}[${index}]`)),
  }
}

const readBaseline = (): Record<string, BaselineRow | undefined> => {
  const document = JSON.parse(readFileSync(baselinePath, 'utf8'))
  const rows = readArray(propertyOf(document, 'rows', baselinePath), `${baselinePath}.rows`).map((entry, index) => {
    const where = `${baselinePath}.rows[${index}]`
    return {
      invocation: readField(entry, 'invocation', readString, where),
      stdoutBytes: readField(entry, 'stdoutBytes', readNumber, where),
      stderrBytes: readField(entry, 'stderrBytes', readNumber, where),
      exitCode: readField(entry, 'exitCode', readNumber, where),
    }
  })
  const pairs: [string, BaselineRow][] = rows.map((row) => [row.invocation, row])
  return Object.fromEntries(pairs)
}

const toStreamResult = (chunk: Buffer | string | null | undefined): StreamResult => {
  if (chunk === null || chunk === undefined) return { bytes: 0, text: '' }
  if (typeof chunk === 'string') return { bytes: Buffer.byteLength(chunk, 'utf8'), text: chunk }
  return { bytes: chunk.byteLength, text: chunk.toString('utf8') }
}

const invoke = (argv: readonly string[]): InvocationResult => {
  const spawned = spawnSync(process.execPath, [binaryPath, ...argv], {
    cwd: evalsDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: invocationTimeoutMs,
    maxBuffer: maxBufferBytes,
  })
  return {
    exitCode: spawned.status ?? -1,
    stdout: toStreamResult(spawned.stdout),
    stderr: toStreamResult(spawned.stderr),
    spawnError: spawned.error === undefined ? undefined : spawned.error.message,
  }
}

const readPath = (value: unknown, path: string): unknown => {
  let current: unknown = value
  for (const key of path.split('.')) {
    if (Array.isArray(current)) current = current[Number(key)]
    else if (typeof current === 'object' && current !== null) {
      current = Object.getOwnPropertyDescriptor(current, key)?.value
    } else return undefined
  }
  return current
}

const sameValue = (actual: unknown, expected: unknown): boolean =>
  actual === expected || JSON.stringify(actual) === JSON.stringify(expected)

const evaluateStream = (expectation: StreamExpectation, result: StreamResult, label: string): string[] => {
  const failures: string[] = []
  if (expectation.empty !== undefined && (result.bytes === 0) !== expectation.empty) {
    failures.push(`${label}: expected empty=${expectation.empty}, got ${result.bytes} bytes`)
  }
  let parsed: unknown = undefined
  let parsedJson = false
  try {
    parsed = JSON.parse(result.text)
    parsedJson = true
  } catch {
    parsedJson = false
  }
  if (expectation.json !== undefined && parsedJson !== expectation.json) {
    failures.push(`${label}: expected json=${expectation.json}, got ${parsedJson ? 'a JSON document' : 'not JSON'}`)
  }
  for (const needle of expectation.contains ?? []) {
    if (!result.text.includes(needle)) failures.push(`${label}: missing text ${JSON.stringify(needle)}`)
  }
  for (const check of expectation.equals ?? []) {
    const actual = parsedJson ? readPath(parsed, check.path) : undefined
    if (!sameValue(actual, check.expected)) {
      failures.push(`${label}: expected ${check.path}=${JSON.stringify(check.expected)}, got ${JSON.stringify(actual)}`)
    }
  }
  for (const path of expectation.present ?? []) {
    if (!parsedJson || readPath(parsed, path) === undefined) failures.push(`${label}: expected ${path} to be present`)
  }
  for (const path of expectation.absent ?? []) {
    if (parsedJson && readPath(parsed, path) !== undefined) failures.push(`${label}: expected ${path} to be absent`)
  }
  return failures
}

const signed = (value: number): string => `${value > 0 ? '+' : ''}${value}`

const formatTable = (headers: readonly string[], body: readonly string[][]): string => {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...body.map((row) => (row[index] ?? '').length))
  )
  const formatRow = (cells: readonly string[]): string =>
    cells.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join('  ').trimEnd()
  const rule = widths.map((width) => '-'.repeat(width)).join('  ')
  return [formatRow(headers), rule, ...body.map(formatRow)].join('\n')
}

const main = (): void => {
  if (!existsSync(binaryPath)) {
    reportFailure(`binary not found: ${binaryPath}`)
    reportFailure('Build the CLI first, or pass the bundle path as the first argument.')
    process.exitCode = 1
    return
  }

  const baseline = readBaseline()
  const files = readdirSync(transcriptsDir).filter((name) => name.endsWith('.json')).sort()
  if (files.length === 0) {
    reportFailure(`no transcripts found in ${transcriptsDir}`)
    process.exitCode = 1
    return
  }

  const rows: Row[] = []
  const failures: string[] = []
  const usedBaselines = new Set<string>()
  let patternCount = 0
  let patternPasses = 0
  let invocationCount = 0
  let invocationPasses = 0

  for (const file of files) {
    const path = resolve(transcriptsDir, file)
    const transcript = readTranscript(JSON.parse(readFileSync(path, 'utf8')), path)
    patternCount += 1
    const patternFailures: string[] = []

    transcript.invocations.forEach((invocation, index) => {
      const label = transcript.invocations.length === 1 ? transcript.pattern : `${transcript.pattern}#${index + 1}`
      invocationCount += 1
      const rowFailures: string[] = []

      let baselineRow: BaselineRow | undefined = undefined
      if (invocation.baseline !== null) {
        baselineRow = baseline[invocation.baseline]
        if (baselineRow === undefined) {
          rowFailures.push(`baseline row ${JSON.stringify(invocation.baseline)} is missing from baseline.json`)
        } else {
          usedBaselines.add(invocation.baseline)
        }
      }

      const result = invoke(invocation.argv)
      if (result.spawnError !== undefined) rowFailures.push(`spawn failed: ${result.spawnError}`)
      if (result.exitCode !== invocation.expect.exitCode) {
        rowFailures.push(`exitCode: expected ${invocation.expect.exitCode}, got ${result.exitCode}`)
      }
      rowFailures.push(
        ...evaluateStream(invocation.expect.stdout, result.stdout, 'stdout'),
        ...evaluateStream(invocation.expect.stderr, result.stderr, 'stderr'),
      )

      if (rowFailures.length === 0) invocationPasses += 1
      else patternFailures.push(...rowFailures.map((failure) => `${label}: ${failure}`))

      rows.push({
        label,
        passed: rowFailures.length === 0,
        exitCode: result.exitCode,
        stdoutBytes: result.stdout.bytes,
        stderrBytes: result.stderr.bytes,
        deltaStdout: baselineRow === undefined ? undefined : result.stdout.bytes - baselineRow.stdoutBytes,
        deltaStderr: baselineRow === undefined ? undefined : result.stderr.bytes - baselineRow.stderrBytes,
      })
    })

    if (patternFailures.length === 0) patternPasses += 1
    else failures.push(...patternFailures)
  }

  report(
    formatTable(
      ['PATTERN', 'RESULT', 'EXIT', 'OUT', 'ERR', 'DELTA_OUT', 'DELTA_ERR'],
      rows.map((row) => [
        row.label,
        row.passed ? 'PASS' : 'FAIL',
        String(row.exitCode),
        String(row.stdoutBytes),
        String(row.stderrBytes),
        row.deltaStdout === undefined ? 'n/a' : signed(row.deltaStdout),
        row.deltaStderr === undefined ? 'n/a' : signed(row.deltaStderr),
      ]),
    ),
  )
  report(`patterns: ${patternPasses}/${patternCount} pass  invocations: ${invocationPasses}/${invocationCount} pass`)
  report(`binary: ${binaryPath}${binaryPath === defaultBinaryPath ? ' (default)' : ''}`)
  report(`baseline: ${Object.keys(baseline).length} rows, ${usedBaselines.size} exercised by transcripts`)

  for (const invocation of Object.keys(baseline)) {
    if (!usedBaselines.has(invocation)) report(`  unexercised baseline row: ${invocation}`)
  }
  for (const failure of failures) reportFailure(`FAIL ${failure}`)

  process.exitCode = patternPasses === patternCount ? 0 : 1
}

main()
