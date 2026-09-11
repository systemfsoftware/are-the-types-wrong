import { recipes } from '@systemfsoftware/arethetypeswrong-recipes'
import { packPackage } from '@systemfsoftware/npm-package'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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
const BASE_IMAGE = 'alpine:3.20@sha256:c64c687cbea9300178b30c95835354e34c4e4febc4badfe27102879de0483b5e'
const VERDACCIO_VERSION = '6.10.3'
const REGISTRY_URL = 'http://127.0.0.1:4873'
const WORKDIR = '/work'
const FIXTURES_DIR = `${WORKDIR}/fixtures`
const CLOSURE_TAR = '/tmp/attw-closure.tar'
const RECIPE_FIXTURES = [recipes.UntypedResolution, recipes.FalseCJS, recipes.MultiEntrypoint]

interface Analysis {
  readonly analysis: {
    readonly packageName: string
    readonly entrypoints: Record<string, unknown>
  }
  readonly problems?: unknown
}

let container: StartedTestContainer
let scratch: string
let cliBin: string
let npmBin: string

const analyzeJson = (stdout: string): Analysis => JSON.parse(stdout) as Analysis
const entrypointsIn = (stdout: string): readonly string[] => Object.keys(analyzeJson(stdout).analysis.entrypoints)

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

const packClosure = async (storePaths: readonly string[], tarPath: string): Promise<void> => {
  const { stdout } = await execFileAsync('nix', ['path-info', '-r', ...storePaths])
  const closure = stdout.trim().split('\n')
  await execFileAsync('tar', ['-cf', tarPath, '-C', '/', ...closure.map((path) => path.slice(1))])
}

const storePathNamed = async (attwStore: string, pattern: RegExp): Promise<string> => {
  const { stdout } = await execFileAsync('nix', ['path-info', '-r', attwStore])
  const match = stdout.trim().split('\n').find((path) => pattern.test(path))
  if (match === undefined) throw new Error(`${pattern} missing from ${attwStore} closure`)
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

  const attwStore = await nixBuild('.#attw')
  const processComposeStore = await nixBuild('nixpkgs#process-compose', ['--inputs-from', '.'])
  const nodeStore = await storePathNamed(attwStore, /[-]nodejs-\d/)
  const bashStore = await storePathNamed(attwStore, /[-]bash-\d/)
  cliBin = `${attwStore}/bin/attw`
  npmBin = `${nodeStore}/bin/npm`

  const verdaccioDir = join(scratch, 'verdaccio')
  await execFileAsync(npmBin, [
    'install',
    '--prefix',
    verdaccioDir,
    `verdaccio@${VERDACCIO_VERSION}`,
    '--omit=dev',
    '--no-fund',
    '--no-audit',
  ])

  const closureTarPath = join(scratch, 'closure.tar')
  await packClosure([attwStore, processComposeStore], closureTarPath)

  const fixturesDir = join(scratch, 'fixtures')
  await writeRecipeFixtures(fixturesDir)
  const registryFixtureDir = join(scratch, 'registry-fixture')
  await writeRegistryFixture(registryFixtureDir)

  container = await new GenericContainer(BASE_IMAGE)
    .withCopyFilesToContainer([
      { source: closureTarPath, target: CLOSURE_TAR },
      { source: join(PACKAGE_DIR, 'process-compose.yaml'), target: `${WORKDIR}/process-compose.yaml` },
      { source: join(PACKAGE_DIR, 'verdaccio.yaml'), target: `${WORKDIR}/verdaccio.yaml` },
    ])
    .withCopyDirectoriesToContainer([
      { source: fixturesDir, target: FIXTURES_DIR },
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
  requireStep('attw --version', await runCli(['--version']))
})

afterAll(async () => {
  await container?.stop()
  if (scratch !== undefined) await rm(scratch, { recursive: true, force: true })
})

describe('attw, built by nix, run in a container', () => {
  test('reports resolution problems for an untyped package', async () => {
    const result = await runCli([`${FIXTURES_DIR}/untyped-resolution.tgz`], FIXTURES_DIR)

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toMatch(
      /NoResolution|UntypedResolution|FalseExportDefault|NamedExports|Resolution failed|No types/,
    )
  })

  test('names the problem for a package with false CommonJS declarations', async () => {
    const result = await runCli([`${FIXTURES_DIR}/false-cjs.tgz`], FIXTURES_DIR)

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toMatch(/FalseCJS/)
  })

  test.each(['table', 'table-flipped', 'ascii'] as const)('renders %s output', async (format) => {
    const result = await runCli([`${FIXTURES_DIR}/false-cjs.tgz`, '-f', format], FIXTURES_DIR)

    expect(result.exitCode).toBe(1)
    expect(result.stdout.length).toBeGreaterThan(0)
  })

  test('emits json naming the analyzed package and its problems', async () => {
    const result = await runCli([`${FIXTURES_DIR}/untyped-resolution.tgz`, '-f', 'json'], FIXTURES_DIR)

    expect(result.exitCode).toBe(1)
    const parsed = analyzeJson(result.stdout)
    expect(parsed.analysis.packageName).toBe('untyped-resolution')
    expect(parsed.problems).toBeDefined()
  })

  test('restricts the analysis to the selected entrypoints', async () => {
    const full = await runCli([`${FIXTURES_DIR}/multi-entrypoint.tgz`, '-f', 'json'], FIXTURES_DIR)
    const restricted = await runCli(
      [`${FIXTURES_DIR}/multi-entrypoint.tgz`, '--entrypoints', '.', '-f', 'json'],
      FIXTURES_DIR,
    )

    expect(entrypointsIn(restricted.stdout).length).toBeLessThan(entrypointsIn(full.stdout).length)
  })

  test('drops excluded entrypoints from the analysis', async () => {
    const result = await runCli(
      [`${FIXTURES_DIR}/multi-entrypoint.tgz`, '--exclude-entrypoints', 'macros', '-f', 'json'],
      FIXTURES_DIR,
    )

    expect(entrypointsIn(result.stdout).some((name) => name.includes('macros'))).toBe(false)
  })

  test('analyzes a package acquired from the verdaccio registry', async () => {
    const result = await runCli([
      '--from-npm',
      `${REGISTRY_FIXTURE_NAME}@${REGISTRY_FIXTURE_VERSION}`,
      '--registry',
      REGISTRY_URL,
      '-f',
      'json',
    ])
    expect(analyzeJson(result.stdout).analysis.packageName).toBe(REGISTRY_FIXTURE_NAME)
  })

  test('packs a directory and analyzes the packed package', async () => {
    const packDir = '/tmp/attw-pack-test'
    const prepared = await runShell(
      `mkdir -p ${packDir} && cd ${packDir} && ` +
        `printf '%s' '{"name":"attw-pack-test","version":"1.0.0","type":"module","main":"index.js"}' > package.json && ` +
        `printf '%s' 'export const v = 1' > index.js`,
    )
    requireStep('prepare pack directory', prepared)

    const result = await runCli(['--pack', '.', '-f', 'json'], packDir)

    expect(result.exitCode).toBe(0)
    expect(analyzeJson(result.stdout).analysis.packageName).toBe('attw-pack-test')
  })

  test('applies a .attw.json waiver found in the working directory', async () => {
    const waiver = `${FIXTURES_DIR}/.attw.json`
    await runShell(`rm -f ${waiver}`)
    const before = await runCli([`${FIXTURES_DIR}/false-cjs.tgz`], FIXTURES_DIR)
    await runShell(`printf '%s' '{"ignoreRules":["false-cjs"]}' > ${waiver}`)
    const after = await runCli([`${FIXTURES_DIR}/false-cjs.tgz`], FIXTURES_DIR)
    await runShell(`rm -f ${waiver}`)

    expect(before.exitCode).toBe(1)
    expect(before.stdout).toMatch(/FalseCJS/)
    expect(after.exitCode).toBe(0)
  })
})
