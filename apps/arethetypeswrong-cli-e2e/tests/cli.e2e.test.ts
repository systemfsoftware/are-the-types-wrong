import { recipes } from '@systemfsoftware/arethetypeswrong-recipes'
import { packPackage } from '@systemfsoftware/npm-package'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { GenericContainer, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { REGISTRY_FIXTURE_FILES, REGISTRY_FIXTURE_NAME, REGISTRY_FIXTURE_VERSION } from './registry.js'

const execFileAsync = promisify(execFile)

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url))
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const CLI_MANIFEST_URL = new URL('../../arethetypeswrong-cli/package.json', import.meta.url)
const BASE_IMAGE = 'alpine:3.20@sha256:c64c687cbea9300178b30c95835354e34c4e4febc4badfe27102879de0483b5e'
const VERDACCIO_VERSION = '6.10.3'
const REGISTRY_URL = 'http://127.0.0.1:4873'
const WORKDIR = '/work'
const FIXTURES_DIR = `${WORKDIR}/fixtures`
const EVAL_FIXTURES_DIR = `${WORKDIR}/eval-fixtures`
const CLOSURE_TAR = '/tmp/attw-closure.tar'
const RECIPE_FIXTURES = [recipes.UntypedResolution, recipes.FalseCJS, recipes.MultiEntrypoint]

interface DecodedEnvelope {
  readonly status: 'ok' | 'untyped'
  readonly packageName: string
  readonly packageVersion: string
  readonly problems: readonly unknown[]
  readonly keys: readonly string[]
}

const analyzeJson = (stdout: string): DecodedEnvelope => {
  const parsed: unknown = JSON.parse(stdout)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`attw printed no envelope object: ${stdout}`)
  }
  const status = 'status' in parsed ? parsed.status : undefined
  const packageName = 'packageName' in parsed ? parsed.packageName : undefined
  const packageVersion = 'packageVersion' in parsed ? parsed.packageVersion : undefined
  const problems = 'problems' in parsed ? parsed.problems : undefined
  if (status !== 'ok' && status !== 'untyped') {
    throw new Error(`attw printed an envelope without a status discriminant: ${stdout}`)
  }
  if (typeof packageName !== 'string' || typeof packageVersion !== 'string') {
    throw new Error(`attw printed an envelope without a package name and version: ${stdout}`)
  }
  if (problems !== undefined && !Array.isArray(problems)) {
    throw new Error(`attw printed problems that are not an array: ${stdout}`)
  }
  return { status, packageName, packageVersion, problems: problems ?? [], keys: Object.keys(parsed) }
}

const errorDocument = (text: string): { readonly kind: string; readonly recovery: string } => {
  const parsed: unknown = JSON.parse(text)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`attw printed no failure document: ${text}`)
  }
  const status = 'status' in parsed ? parsed.status : undefined
  const kind = 'kind' in parsed ? parsed.kind : undefined
  const recovery = 'recovery' in parsed ? parsed.recovery : undefined
  if (status !== 'error' || typeof kind !== 'string' || typeof recovery !== 'string') {
    throw new Error(`attw printed no failure document: ${text}`)
  }
  return { kind, recovery }
}

const failureDocument = errorDocument

const usageErrorDocument = (
  stderr: string,
): { readonly kind: string; readonly recovery: string } => {
  const [line = ''] = stderr.split('\n')
  return errorDocument(line)
}

const schemaDocument = (
  stdout: string,
): { readonly version: string; readonly input: unknown; readonly envelope: unknown } => {
  const parsed: unknown = JSON.parse(stdout)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`attw schema printed no document: ${stdout}`)
  }
  if (!('version' in parsed) || typeof parsed.version !== 'string') {
    throw new Error(`attw schema printed no version: ${stdout}`)
  }
  if (!('input' in parsed) || !('envelope' in parsed)) {
    throw new Error(`attw schema printed no input and envelope sections: ${stdout}`)
  }
  return { version: parsed.version, input: parsed.input, envelope: parsed.envelope }
}

let container: StartedTestContainer
let scratch: string
let cliBin: string
let npmBin: string

const cliManifest = async (url: URL): Promise<{ readonly command: string; readonly version: string }> => {
  const manifest: unknown = JSON.parse(await readFile(url, 'utf8'))
  if (
    typeof manifest !== 'object' || manifest === null ||
    !('version' in manifest) || typeof manifest.version !== 'string' ||
    !('bin' in manifest) || typeof manifest.bin !== 'object' || manifest.bin === null
  ) {
    throw new Error(`${url.pathname} declares no string version and bin entry`)
  }
  const commands = Object.keys(manifest.bin)
  const [command] = commands
  if (command === undefined || commands.length !== 1) {
    throw new Error(`${url.pathname} declares ${commands.length} bin entries; the printed name needs exactly one`)
  }
  return { command, version: manifest.version }
}

const ANSI_SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
const stripAnsi = (text: string): string => text.replace(ANSI_SGR, '')

const RESOLUTION_COLUMNS = ['node10', 'node16-cjs', 'node16-esm', 'bundler'] as const

const TABLE_HEADER = ['Entrypoint', ...RESOLUTION_COLUMNS]

const emojiProblemCells = /^[✘◌⚠]+$/
const asciiProblemCells = /^[X!-]+$/
const okCells = /^(?:✔|OK)$/

interface HumanTable {
  readonly header: readonly string[]
  readonly rows: readonly (readonly string[])[]
}

const humanTable = (stdout: string): HumanTable => {
  const lines = stripAnsi(stdout).split('\n').filter((line) => line.trim() !== '')
  const headerIndex = lines.findIndex((line) => line.trim().startsWith('Entrypoint'))
  if (headerIndex === -1) throw new Error(`attw printed no human table: ${stdout}`)
  const headerLine = lines[headerIndex]
  if (headerLine === undefined) throw new Error(`attw printed no human table: ${stdout}`)
  const header = headerLine.trim().split(/\s{2,}/)
  const rows = lines.slice(headerIndex + 1).map((line) => line.trim().split(/\s{2,}/))
  return { header, rows }
}

const expectHumanTable = (
  stdout: string,
  expected: { readonly header: readonly string[]; readonly labels: readonly string[] },
  cell: RegExp,
): void => {
  expect(() => JSON.parse(stdout)).toThrow()
  const table = humanTable(stdout)
  expect(table.header).toEqual([...expected.header])
  expect(table.rows.map((row) => row[0])).toEqual([...expected.labels])
  for (const row of table.rows) {
    expect(row.length).toBe(table.header.length)
    for (const value of row.slice(1)) expect(value).toMatch(cell)
  }
}

const runCli = async (args: readonly string[], cwd = WORKDIR) => {
  const result = await container.exec([cliBin, ...args], { workingDir: cwd })
  return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }
}

const runShell = (script: string) => container.exec(['sh', '-c', script], { workingDir: WORKDIR })

const requireStep = (name: string, result: { readonly exitCode: number }): void => {
  if (result.exitCode !== 0) throw new Error(`${name} exited ${result.exitCode}`)
}

const nixBuild = async (installable: string, extraArgs: readonly string[] = []): Promise<string> => {
  const { stdout } = await execFileAsync(
    'nix',
    ['build', ...extraArgs, installable, '--no-link', '--print-out-paths'],
    {
      cwd: REPO_ROOT,
    },
  )
  return stdout.trim()
}

const namedIn = (closure: readonly string[], pattern: RegExp): string => {
  const match = closure.find((path) => pattern.test(path))
  if (match === undefined) throw new Error(`${pattern} missing from closure`)
  return match
}

const writeRecipeFixtures = async (dir: string): Promise<void> => {
  await mkdir(dir, { recursive: true })
  for (const recipe of RECIPE_FIXTURES) {
    const pkg = recipe()
    await writeFile(join(dir, `${pkg.packageName}.tgz`), packPackage(pkg))
  }
}

const writeRegistryFixture = async (dir: string): Promise<void> => {
  await mkdir(dir, { recursive: true })
  for (const [name, content] of Object.entries(REGISTRY_FIXTURE_FILES)) {
    await writeFile(join(dir, name), content)
  }
}

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'attw-e2e-'))

  const [attwStore, processComposeStore] = await Promise.all([
    nixBuild('.#attw'),
    nixBuild('nixpkgs#process-compose', ['--inputs-from', '.']),
  ])
  const { stdout } = await execFileAsync('nix', ['path-info', '-r', attwStore, processComposeStore])
  const closure = stdout.trim().split('\n')
  const nodeStore = namedIn(closure, /[-]nodejs-\d/)
  const bashStore = namedIn(closure, /[-]bash-\d/)
  cliBin = `${attwStore}/bin/attw`
  npmBin = `${nodeStore}/bin/npm`

  const verdaccioDir = join(scratch, 'verdaccio')
  const fixturesDir = join(scratch, 'fixtures')
  const registryFixtureDir = join(scratch, 'registry-fixture')
  const closureTarPath = join(scratch, 'closure.tar')
  await Promise.all([
    execFileAsync('tar', ['-cf', closureTarPath, '-C', '/', ...closure.map((path) => path.slice(1))]),
    execFileAsync(npmBin, [
      'install',
      '--prefix',
      verdaccioDir,
      `verdaccio@${VERDACCIO_VERSION}`,
      '--omit=dev',
      '--no-fund',
      '--no-audit',
    ]),
    writeRecipeFixtures(fixturesDir),
    writeRegistryFixture(registryFixtureDir),
  ])

  container = await new GenericContainer(BASE_IMAGE)
    .withCopyFilesToContainer([
      { source: closureTarPath, target: CLOSURE_TAR },
      { source: join(PACKAGE_DIR, 'process-compose.yaml'), target: `${WORKDIR}/process-compose.yaml` },
      { source: join(PACKAGE_DIR, 'verdaccio.yaml'), target: `${WORKDIR}/verdaccio.yaml` },
    ])
    .withCopyDirectoriesToContainer([
      { source: fixturesDir, target: FIXTURES_DIR },
      { source: join(PACKAGE_DIR, 'evals', 'fixtures'), target: EVAL_FIXTURES_DIR },
      { source: verdaccioDir, target: '/opt/verdaccio' },
      { source: registryFixtureDir, target: `${WORKDIR}/registry-fixture` },
    ])
    .withEnvironment({
      PATH: [
        `${nodeStore}/bin`,
        `${bashStore}/bin`,
        '/opt/verdaccio/node_modules/.bin',
        `${processComposeStore}/bin`,
        '/usr/local/sbin',
        '/usr/local/bin',
        '/usr/sbin',
        '/usr/bin',
        '/sbin',
        '/bin',
      ].join(':'),
    })
    .withWorkingDir(WORKDIR)
    .withLogConsumer((stream) => {
      stream.pipe(process.stderr, { end: false })
    })
    .withCommand(['sleep', 'infinity'])
    .start()

  requireStep('extract nix closure', await container.exec(['tar', '-xf', CLOSURE_TAR, '-C', '/']))

  const processCompose = `${processComposeStore}/bin/process-compose`
  requireStep(
    'process-compose up verdaccio',
    await container.exec([
      processCompose,
      '--log-file',
      '/proc/1/fd/1',
      'up',
      '--detached',
      '--tui=false',
      '-f',
      `${WORKDIR}/process-compose.yaml`,
    ]),
  )
  requireStep(
    'verdaccio /-/ping',
    await container.exec([
      `${nodeStore}/bin/node`,
      '-e',
      'const d=Date.now()+5000; (async function tick(){try{if((await fetch("http://127.0.0.1:4873/-/ping")).ok)process.exit(0)}catch{} if(Date.now()>d)process.exit(1); setImmediate(tick)})()',
    ]),
  )
  requireStep(
    'write npmrc token',
    await container.exec(['sh', '-c', "printf '%s\\n' '//127.0.0.1:4873/:_authToken=e2e' > /root/.npmrc"]),
  )
  requireStep(
    'npm publish fixture to verdaccio',
    await container.exec([
      npmBin,
      'publish',
      `${WORKDIR}/registry-fixture`,
      '--registry',
      REGISTRY_URL,
      '--loglevel=error',
    ]),
  )
})

afterAll(async () => {
  await container?.stop()
  if (scratch !== undefined) await rm(scratch, { recursive: true, force: true })
})

describe('attw, built by nix, run in a container', () => {
  test('prints the version of the CLI package it was built from', async () => {
    const result = await runCli(['--version'])
    const { command, version } = await cliManifest(CLI_MANIFEST_URL)

    expect(result.exitCode).toBe(0)
    expect(stripAnsi(result.stdout).trim()).toBe(`${command} v${version}`)
  })

  test('reports resolution problems for an untyped package', async () => {
    const result = await runCli([`${FIXTURES_DIR}/untyped-resolution.tgz`, '-f', 'table'], FIXTURES_DIR)

    expect(result.exitCode).toBe(1)
    expectHumanTable(result.stdout, { header: TABLE_HEADER, labels: ['.'] }, /^◌+$/)
  })

  test('names the problem for a package with false CommonJS declarations', async () => {
    const result = await runCli([`${FIXTURES_DIR}/false-cjs.tgz`, '-f', 'table'], FIXTURES_DIR)

    expect(result.exitCode).toBe(1)
    expectHumanTable(result.stdout, { header: TABLE_HEADER, labels: ['.'] }, /^✘+$/)
  })

  test('renders table-flipped output as a human table', async () => {
    const result = await runCli([`${FIXTURES_DIR}/false-cjs.tgz`, '-f', 'table-flipped'], FIXTURES_DIR)

    expect(result.exitCode).toBe(1)
    expectHumanTable(result.stdout, { header: ['Entrypoint', '.'], labels: RESOLUTION_COLUMNS }, /^✘+$/)
  })

  test('renders ascii output as a human table', async () => {
    const result = await runCli([`${FIXTURES_DIR}/false-cjs.tgz`, '-f', 'ascii', '--no-emoji'], FIXTURES_DIR)

    expect(result.exitCode).toBe(1)
    expectHumanTable(result.stdout, { header: TABLE_HEADER, labels: ['.'] }, asciiProblemCells)
  })

  test('renders the human table when the format is explicit on a non-TTY stream', async () => {
    const result = await runCli([`${FIXTURES_DIR}/multi-entrypoint.tgz`, '-f', 'table'], FIXTURES_DIR)

    expect(result.exitCode).toBe(1)
    expectHumanTable(result.stdout, { header: TABLE_HEADER, labels: ['.', './macros', './utils'] }, emojiProblemCells)
  })

  test('writes one compact JSON document on a non-TTY stream with no format flag', async () => {
    const result = await runCli([`${FIXTURES_DIR}/false-cjs.tgz`], FIXTURES_DIR)

    expect(result.exitCode).toBe(1)
    expect(result.stdout.endsWith('\n')).toBe(true)
    expect(result.stdout.trimEnd().includes('\n')).toBe(false)
    expect(result.stdout).not.toContain(String.fromCharCode(27))
    expect(analyzeJson(result.stdout).status).toBe('ok')
  })

  test('keeps the default envelope field-tight', async () => {
    const typed = await runCli([`${FIXTURES_DIR}/false-cjs.tgz`], FIXTURES_DIR)
    const untyped = await runCli([`${EVAL_FIXTURES_DIR}/untyped.tgz`], EVAL_FIXTURES_DIR)

    expect(typed.exitCode).toBe(1)
    const envelope = analyzeJson(typed.stdout)
    expect([...envelope.keys].sort()).toEqual([
      'packageName',
      'packageVersion',
      'problemCounts',
      'problems',
      'status',
      'types',
    ])
    expect(envelope.problems.length).toBeGreaterThan(0)
    expect(typed.stdout).not.toContain('"trace"')

    expect(untyped.exitCode).toBe(0)
    const untypedEnvelope = analyzeJson(untyped.stdout)
    expect(untypedEnvelope.status).toBe('untyped')
    expect(untypedEnvelope.keys).not.toContain('problems')
  })

  test('agrees the envelope with the exit code under a profile that silences every problem', async () => {
    const result = await runCli(['--profile', 'node16', `${EVAL_FIXTURES_DIR}/typed-node10.tgz`], EVAL_FIXTURES_DIR)

    expect(result.exitCode).toBe(0)
    const envelope = analyzeJson(result.stdout)
    expect(envelope.status).toBe('ok')
    expect(envelope.problems).toEqual([])
  })

  test('hints the expansion flag on a non-TTY run with the default mask', async () => {
    const result = await runCli([`${FIXTURES_DIR}/false-cjs.tgz`], FIXTURES_DIR)

    expect(result.exitCode).toBe(1)
    const hints = result.stderr.split('\n').filter((line) => line !== '')
    expect(hints).toHaveLength(1)
    expect(hints[0]).toContain('--include')
    for (const field of ['entrypoints', 'buildTools', 'programInfo', 'traces']) {
      expect(hints[0]).toContain(field)
    }
  })

  test('restores a requested field with --include and stays silent', async () => {
    const result = await runCli([`${FIXTURES_DIR}/false-cjs.tgz`, '--include', 'entrypoints'], FIXTURES_DIR)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe('')
    expect(analyzeJson(result.stdout).keys).toContain('entrypoints')
  })

  test('emits json naming the analyzed package and its problems', async () => {
    const result = await runCli([`${FIXTURES_DIR}/untyped-resolution.tgz`, '-f', 'json'], FIXTURES_DIR)

    expect(result.exitCode).toBe(1)
    const parsed = analyzeJson(result.stdout)
    expect(parsed.packageName).toBe('untyped-resolution')
    expect(parsed.problems.length).toBeGreaterThan(0)
  })

  test('restricts the analysis to the selected entrypoints', async () => {
    const full = await runCli([`${FIXTURES_DIR}/multi-entrypoint.tgz`, '-f', 'table'], FIXTURES_DIR)
    const restricted = await runCli(
      [`${FIXTURES_DIR}/multi-entrypoint.tgz`, '--entrypoints', '.', '-f', 'table'],
      FIXTURES_DIR,
    )

    expect(humanTable(restricted.stdout).rows.length).toBeLessThan(humanTable(full.stdout).rows.length)
  })

  test('drops excluded entrypoints from the analysis', async () => {
    const result = await runCli(
      [`${FIXTURES_DIR}/multi-entrypoint.tgz`, '--exclude-entrypoints', 'macros', '-f', 'table'],
      FIXTURES_DIR,
    )

    expect(humanTable(result.stdout).rows.some((row) => (row[0] ?? '').includes('macros'))).toBe(false)
  })

  test('analyzes a package acquired from the verdaccio registry', async () => {
    const result = await runCli([
      '--from-npm',
      `${REGISTRY_FIXTURE_NAME}@${REGISTRY_FIXTURE_VERSION}`,
      '--registry',
      REGISTRY_URL,
    ])
    expect(analyzeJson(result.stdout).packageName).toBe(REGISTRY_FIXTURE_NAME)
  })

  test('packs a directory and analyzes the packed package', async () => {
    const packDir = '/tmp/attw-pack-test'
    const prepared = await runShell(
      `mkdir -p ${packDir} && cd ${packDir} && ` +
        `printf '%s' '{"name":"attw-pack-test","version":"1.0.0","type":"module","main":"index.js"}' > package.json && ` +
        `printf '%s' 'export const v = 1' > index.js`,
    )
    requireStep('prepare pack directory', prepared)

    const result = await runCli(['--pack', '.'], packDir)

    expect(result.exitCode).toBe(0)
    expect(analyzeJson(result.stdout).packageName).toBe('attw-pack-test')
  })

  test('applies a .attw.json waiver found in the working directory', async () => {
    const waiver = `${FIXTURES_DIR}/.attw.json`
    await runShell(`rm -f ${waiver}`)
    const before = await runCli([`${FIXTURES_DIR}/false-cjs.tgz`, '-f', 'table'], FIXTURES_DIR)
    await runShell(`printf '%s' '{"ignoreRules":["false-cjs"]}' > ${waiver}`)
    const after = await runCli([`${FIXTURES_DIR}/false-cjs.tgz`, '-f', 'table'], FIXTURES_DIR)
    await runShell(`rm -f ${waiver}`)

    expect(before.exitCode).toBe(1)
    expectHumanTable(before.stdout, { header: TABLE_HEADER, labels: ['.'] }, /^✘+$/)
    expect(after.exitCode).toBe(0)
    expectHumanTable(after.stdout, { header: TABLE_HEADER, labels: ['.'] }, okCells)
  })

  test('fails an unreadable tarball with a typed document and an empty stdout', async () => {
    await runShell(`printf '%s' 'not a tarball' > ${FIXTURES_DIR}/corrupt.tgz`)
    const result = await runCli([`${FIXTURES_DIR}/corrupt.tgz`], FIXTURES_DIR)

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    const failure = failureDocument(result.stderr)
    expect(failure.kind).toBe('AnalysisFailed')
    expect(failure.recovery.length).toBeGreaterThan(0)
  })

  test('reports an unreachable registry with a typed document and an empty stdout', async () => {
    const result = await runCli(['--from-npm', 'attw-never-resolves', '--registry', 'http://127.0.0.1:9'])

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(failureDocument(result.stderr).kind).toBe('RegistryUnreachable')
  })

  test('refuses a package spec welded to URL syntax before any registry call', async () => {
    const result = await runCli(['--from-npm', 'pkg?fields=name', '--registry', 'http://127.0.0.1:9'])

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(failureDocument(result.stderr).kind).toBe('InvalidPackageSpec')
  })

  test('describes its input surface and envelope as JSON Schema documents', async () => {
    const { version } = await cliManifest(CLI_MANIFEST_URL)
    const result = await runCli(['schema'])

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    const document = schemaDocument(result.stdout)
    expect(document.version).toBe(version)
    const input = JSON.stringify(document.input)
    for (const flag of ['pack', 'from-npm', 'definitely-typed', 'format', 'quiet', 'registry', 'profile']) {
      expect(input).toContain(`"${flag}"`)
    }
    const envelope = JSON.stringify(document.envelope)
    for (const field of ['"ok"', '"untyped"', '"status"', '"packageName"', '"problemCounts"']) {
      expect(envelope).toContain(field)
    }
  })

  test('analyzes the same package through the analyze subcommand as through the bare alias', async () => {
    const bare = await runCli([`${FIXTURES_DIR}/multi-entrypoint.tgz`], FIXTURES_DIR)
    const explicit = await runCli(['analyze', `${FIXTURES_DIR}/multi-entrypoint.tgz`], FIXTURES_DIR)

    expect(explicit.exitCode).toBe(bare.exitCode)
    expect(explicit.stdout).toBe(bare.stdout)
    expect(explicit.stderr).toBe(bare.stderr)
  })

  test('keeps an unknown flag out of stdout with a typed stderr document', async () => {
    const result = await runCli(['--definitely-not-a-flag', `${FIXTURES_DIR}/false-cjs.tgz`], FIXTURES_DIR)

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    const failure = usageErrorDocument(result.stderr)
    expect(failure.kind).toBe('UnrecognizedOption')
    expect(failure.recovery.length).toBeGreaterThan(0)
  })

  test('refuses extra arguments to the schema subcommand instead of analyzing them', async () => {
    const bare = await runCli(['schema', 'extra-arg'])
    const pathLike = await runCli(['schema', `${FIXTURES_DIR}/false-cjs.tgz`], FIXTURES_DIR)

    expect(bare.exitCode).toBe(1)
    expect(bare.stdout).toBe('')
    expect(usageErrorDocument(bare.stderr).kind).toBe('UnexpectedArgument')
    expect(pathLike.exitCode).toBe(1)
    expect(pathLike.stdout).toBe('')
    expect(usageErrorDocument(pathLike.stderr).kind).toBe('UnexpectedArgument')
  })
})
