import { createPackageFromTarballData, type Package } from '@systemfsoftware/npm-package'
import { Context, Effect, Layer } from 'effect'

export interface TarballFile {
  readonly path: string
  readonly content: Uint8Array
}

export interface ExtractedTarball {
  readonly packageName: string
  readonly packageVersion: string
  readonly files: readonly TarballFile[]
}

export class TarballAdapterError extends Error {}

export interface TarballAdapterService {
  readonly extract: (tarball: Uint8Array) => Effect.Effect<ExtractedTarball, TarballAdapterError>
}

export class TarballAdapter extends Context.Service<TarballAdapter, TarballAdapterService>()(
  '@systemfsoftware/arethetypeswrong/TarballAdapter',
) {}

export const TarballAdapterLive: Layer.Layer<TarballAdapter, never, never> = Layer.succeed(
  TarballAdapter,
  {
    extract: (tarball) =>
      Effect.try({
        try: () => extractTarball(tarball),
        catch: (e) => {
          if (e instanceof TarballAdapterError) {
            return e
          }
          return new TarballAdapterError('Failed to extract tarball', { cause: e })
        },
      }),
  },
)

export const TarballAdapterStub = (
  files: readonly TarballFile[],
): Layer.Layer<TarballAdapter, never, never> =>
  Layer.succeed(TarballAdapter, {
    extract: () =>
      Effect.succeed({
        packageName: 'stub-package',
        packageVersion: '0.0.0',
        files,
      }),
  })

function extractTarball(tarball: Uint8Array): ExtractedTarball {
  const pkg = createPackageFromTarballData(tarball)
  const packageName = pkg.packageName
  const packageJsonPath = `/node_modules/${packageName}/package.json`
  const files = pkg.listFiles()
    .filter((path) => path !== packageJsonPath)
    .flatMap((path) => collectTarballFile(pkg, path))
  return { packageName, packageVersion: pkg.packageVersion, files }
}

function collectTarballFile(pkg: Package, path: string): TarballFile[] {
  const raw = pkg.tryReadBytes(path)
  if (raw === undefined) {
    return []
  }
  return [{ path, content: toBytes(raw) }]
}

function toBytes(raw: string | Uint8Array): Uint8Array {
  if (typeof raw === 'string') {
    return new TextEncoder().encode(raw)
  }
  return raw
}
