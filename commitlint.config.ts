import type { UserConfig } from '@commitlint/types'
import { execFileSync } from 'node:child_process'

/**
 * Single-package repo: scopes are a static enum, not discovered from a
 * workspace. `solutions` covers docs/solutions/ entries; `global` covers
 * repo-wide docs and plans.
 */
const SCOPES = ['repo', 'deps', 'release', 'ci', 'global', 'solutions'] as const

const matchesAny = (...patterns: readonly RegExp[]) => (path: string) => patterns.some((p) => p.test(path))

const isDoc = matchesAny(
  /\.mdx?$/,
  /^docs\//,
  /(^|\/)README\.md$/i,
  /(^|\/)AGENTS\.md$/i,
  /(^|\/)CLAUDE\.md$/i,
  /(^|\/)CHANGELOG\.md$/i,
)

const isTest = matchesAny(
  /\.(test|spec|tst)\.(ts|tsx|js|jsx|mjs|cjs)$/,
  /(^|\/)__tests__\//,
  /(^|\/)__mocks__\//,
  /(^|\/)tests\//,
  /(^|\/)test-helpers\//,
  /(^|\/)e2e\//,
  /(^|\/)fixtures\//,
)

const isCI = matchesAny(
  /^\.github\/workflows\//,
  /^\.github\/actions\//,
  /^\.github\/dependabot\.ya?ml$/,
)

const isLockfile = matchesAny(
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)package-lock\.json$/,
  /(^|\/)bun\.lockb?$/,
  /(^|\/)yarn\.lock$/,
)

const isTooling = matchesAny(
  /^\.claude\//,
  /^\.husky\//,
  /(^|\/)commitlint\.config\.[mc]?[jt]s$/,
  /(^|\/)\.lintstagedrc(\..+)?$/,
  /(^|\/)tsconfig.*\.json$/,
  /(^|\/)vitest\.config\.[mc]?[jt]s$/,
  /(^|\/)stryker\.conf(ig)?\.[mc]?[jt]s$/,
  /(^|\/)stryker(\..+)?\.json$/,
  /(^|\/)\.editorconfig$/,
  /(^|\/)\.gitignore$/,
  /(^|\/)biome\.json$/,
  /(^|\/)oxlint\.config\.[mc]?[jt]s$/,
  /(^|\/)\.dprint\.jsonc?$/,
  /(^|\/)package\.json$/,
  /(^|\/)pnpm-workspace\.yaml$/,
  /(^|\/)\.npmrc$/,
  /(^|\/)dprint\.json$/,
  /(^|\/)\.envrc$/,
  /^nix\//,
  /^bin\//,
  /^flake\.nix$/,
  /^flake\.lock$/,
)

const ALLOWED_BY_SHAPE: readonly {
  readonly name: string
  readonly match: (path: string) => boolean
  readonly allowed: Readonly<Record<string, true>>
}[] = [
  { name: 'docs', match: isDoc, allowed: { docs: true, chore: true, ai: true } },
  { name: 'test', match: isTest, allowed: { test: true, chore: true } },
  { name: 'CI', match: isCI, allowed: { ci: true, chore: true } },
  { name: 'lockfile', match: isLockfile, allowed: { deps: true, chore: true } },
  {
    name: 'tooling',
    match: isTooling,
    allowed: { chore: true, build: true, ci: true, deps: true, ai: true, security: true },
  },
]

const stagedFiles = (): readonly string[] => {
  try {
    const output = execFileSync('git', ['diff', '--cached', '--name-only'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'] as const,
    })
    return output
      .split('\n')
      .map((l: string) => l.trim())
      .filter((l: string) => l.length > 0)
  } catch {
    return []
  }
}

const configuration: UserConfig = {
  extends: ['@commitlint/config-conventional'],

  plugins: [
    {
      rules: {
        'no-ai-coauthors': ({ raw }) => {
          if (raw == null || raw === '') {
            return [true, 'OK']
          }

          // AI co-author email patterns
          const aiEmailPatterns = [
            /noreply@anthropic\.com/i,
            /cursoragent@cursor\.com/i,
            /noreply@aider\.dev/i,
            /cascade@windsurf\.com/i,
            /noreply@codeium\.com/i,
            /clio-agent@sisyphuslabs\.ai/i,
            /factory-droid\[bot\]@users\.noreply\.github\.com/i,
          ] as const

          // Only scan Co-authored-by lines for AI model mentions to avoid false positives
          // (e.g., "Opus" audio codec, "Haiku" build tool)
          const coauthorLines = raw.match(/^Co-?-?[Aa]uthored-by:.*$/gmi) || []
          const aiModelPatterns = [
            /\b(Claude\s+)?(Opus|Sonnet|Haiku)\b/i,
            /\bgpt-4o\b/i,
            /\bClaude\b.*\b3\.\d+\b/i,
          ] as const
          const hasAIModelInCoauthor = coauthorLines.some((line: string) =>
            aiModelPatterns.some((pattern) => pattern.test(line))
          )

          const hasAIEmail = aiEmailPatterns.some((pattern) => pattern.test(raw))
          const hasAICoauthor = hasAIEmail || hasAIModelInCoauthor

          const message = 'AI co-authors and AI model references are not allowed in commit messages'
          if (hasAICoauthor) return [false, message]
          return [true, 'OK']
        },

        'type-matches-diff-shape': ({ type }) => {
          const files = stagedFiles()
          if (files.length === 0 || type == null || type === '') return [true, 'OK']

          const allMatch = (m: (p: string) => boolean) => files.every(m)

          for (const shape of ALLOWED_BY_SHAPE) {
            if (allMatch(shape.match) && !(type in shape.allowed)) {
              const allowed = Object.keys(shape.allowed).sort().join(' / ')
              return [false, `'${type}' with 100% ${shape.name} paths — REQUIRED type: ${allowed}`]
            }
          }

          if (type === 'feat' || type === 'fix') {
            const hasProductionSource = files.some(
              (p) => !isDoc(p) && !isTest(p) && !isCI(p) && !isLockfile(p) && !isTooling(p),
            )
            if (!hasProductionSource) {
              return [
                false,
                `'${type}' MUST touch >=1 production source file (none of: docs, test, CI, lockfile, tooling)`,
              ]
            }
          }

          return [true, 'OK']
        },
      },
    },
  ],

  rules: {
    // AI co-author prevention (enforced)
    'no-ai-coauthors': [2, 'always'],
    'type-matches-diff-shape': [2, 'always'],

    // Commit types — aligned with semantic-release changelog filtering
    // feat/fix/perf/api/revert/improvement/deps/security bump a version; the rest are noise-filtered out of the changelog
    'type-enum': [
      2,
      'always',
      [
        'ai',
        'api',
        'build',
        'chore',
        'ci',
        'deps',
        'docs',
        'feat',
        'fix',
        'improvement',
        'perf',
        'refactor',
        'revert',
        'security',
        'style',
        'test',
      ],
    ],

    // Static scope enum — single-package repo, no workspace discovery
    'scope-enum': [2, 'always', [...SCOPES]],
    'scope-case': [2, 'always', 'kebab-case'],

    // Type constraints
    'type-case': [2, 'always', 'lower-case'],
    'type-empty': [2, 'never'],

    // Subject — case disabled (agents capitalize; cosmetic, no release impact)
    'subject-case': [0],
    'subject-empty': [2, 'never'],
    'subject-full-stop': [2, 'never', '.'],

    // Disabled — length / blank-line cosmetics that burn tokens on retries; semantic-release ignores them
    'header-max-length': [0],
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
    'body-leading-blank': [0],
    'footer-leading-blank': [0],

    // Structural constraints (kept — low friction, prevent trailing-period noise)
    'header-full-stop': [2, 'never', '.'],
    'body-full-stop': [2, 'never', '.'],

    // References encouraged but not required (warning, non-blocking)
    'references-empty': [1, 'never'],
  },

  defaultIgnores: true,
  ignores: [(commit) => commit.startsWith("Squashed '") || commit.includes('git-subtree-dir:')],
  formatter: '@commitlint/format',
}

export default configuration
