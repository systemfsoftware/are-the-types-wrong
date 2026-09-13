import type { Package } from '@systemfsoftware/npm-package'
import { Cache, Effect, MutableHashMap, Option, Schema } from 'effect'
import ts from 'typescript'
import { type ModuleKind, type ModuleKindReason } from '../Types.js'
import { isNonEmptyString } from '../Utils.js'
import minimalLibDts from './MinimalLibDts.js'

/** @internal */
export interface ResolveModuleNameResult {
  resolution: ts.ResolvedModuleWithFailedLookupLocations
  trace: string[]
}

/** @internal */
export interface CompilerHost {
  readonly getCompilerOptions: () => ts.CompilerOptions
  readonly getSourceFile: (fileName: string) => ts.SourceFile | undefined
  readonly getSourceFileFromCache: (fileName: string) => ts.SourceFile | undefined
  readonly getModuleKindForFile: (fileName: string) => ModuleKind | undefined
  readonly resolveModuleName: (
    moduleName: string,
    containingFile: string,
    resolutionMode?: ts.ModuleKind.ESNext | ts.ModuleKind.CommonJS,
    noDtsResolution?: boolean,
    allowJs?: boolean,
  ) => ResolveModuleNameResult
  readonly getTrace: (
    fromFileName: string,
    moduleSpecifier: string,
    resolutionMode: ts.ModuleKind.ESNext | ts.ModuleKind.CommonJS | undefined,
  ) => string[] | undefined
  readonly getResolvedModule: (
    sourceFile: ts.SourceFile,
    moduleName: string,
    resolutionMode: ts.ResolutionMode,
  ) => ts.ResolvedModuleWithFailedLookupLocations | undefined
  readonly createPrimaryProgram: (rootName: string) => Effect.Effect<ts.Program>
  readonly createAuxiliaryProgram: (
    rootNames: string[],
    extraOptions?: ts.CompilerOptions,
  ) => Effect.Effect<ts.Program>
}

/** @internal */
export interface CompilerHosts {
  readonly node10: CompilerHost
  readonly node16: CompilerHost
  readonly bundler: CompilerHost
  readonly findHostForFiles: (files: string[]) => CompilerHost | undefined
}

/** @internal */
export const createCompilerHosts = (pkg: Package): Effect.Effect<CompilerHosts> =>
  Effect.gen(function*() {
    const node10 = yield* makeCompilerHost(pkg, ts.ModuleResolutionKind.Node10, ts.ModuleKind.CommonJS)
    const node16 = yield* makeCompilerHost(pkg, ts.ModuleResolutionKind.Node16, ts.ModuleKind.Node16)
    const bundler = yield* makeCompilerHost(pkg, ts.ModuleResolutionKind.Bundler, ts.ModuleKind.ESNext)

    return {
      node10,
      node16,
      bundler,
      findHostForFiles(files: string[]) {
        return [node10, node16, bundler].find((host) =>
          files.every((file) => host.getSourceFileFromCache(file) !== undefined)
        )
      },
    }
  })

const getCanonicalFileName = ts.createGetCanonicalFileName(false)
const toPath = (fileName: string) => ts.toPath(fileName, '/', getCanonicalFileName)

const moduleExtensions: readonly string[] = [
  ts.Extension.Cjs,
  ts.Extension.Cts,
  ts.Extension.Dcts,
  ts.Extension.Mjs,
  ts.Extension.Mts,
  ts.Extension.Dmts,
]

const makeCompilerHost = (
  pkg: Package,
  moduleResolution: ts.ModuleResolutionKind,
  moduleKind: ts.ModuleKind,
): Effect.Effect<CompilerHost> =>
  Effect.gen(function*() {
    const compilerOptions: ts.CompilerOptions = {
      moduleResolution,
      module: moduleKind,
      moduleDetection: ts.ModuleDetectionKind.Legacy,
      target: ts.ScriptTarget.Latest,
      resolveJsonModule: true,
      traceResolution: true,
    }

    const normalModuleResolutionCache = ts.createModuleResolutionCache('/', getCanonicalFileName, compilerOptions)
    const noDtsResolutionModuleResolutionCache = ts.createModuleResolutionCache(
      '/',
      getCanonicalFileName,
      compilerOptions,
    )

    const moduleResolutionCache: Record<string, Record<string, ResolveModuleNameResult | undefined> | undefined> = {}

    const getCachedResolution = (containingFile: string, moduleKey: string): ResolveModuleNameResult | undefined =>
      moduleResolutionCache[containingFile]?.[moduleKey]

    const sourceFileCache = MutableHashMap.empty<ts.Path, ts.SourceFile>()
    const languageVersion = ts.ScriptTarget.Latest

    const traces: string[] = []
    const trace = (message: string): void => {
      traces.push(message)
    }
    const readTraces = (): string[] => {
      const result = traces.slice()
      traces.length = 0
      return result
    }
    const clearTraces = (): void => {
      traces.length = 0
    }

    let compilerHost!: ts.CompilerHost

    const getModuleKey = (
      moduleSpecifier: string,
      resolutionMode: ts.ModuleKind.ESNext | ts.ModuleKind.CommonJS | undefined,
      noDtsResolution: boolean | undefined,
      allowJs: boolean | undefined,
    ): string => `${resolutionMode ?? 1}:${+(noDtsResolution === true)}:${+(allowJs === true)}:${moduleSpecifier}`

    const getImpliedNodeFormatForFile = (
      fileName: string,
    ): ts.ModuleKind.ESNext | ts.ModuleKind.CommonJS | undefined =>
      ts.getImpliedNodeFormatForFile(
        toPath(fileName),
        normalModuleResolutionCache.getPackageJsonInfoCache(),
        compilerHost,
        compilerOptions,
      )

    const getPackageScopeForPath = (fileName: string): ts.PackageJsonInfo | undefined =>
      ts.getPackageScopeForPath(
        fileName,
        ts.getTemporaryModuleResolutionState(
          normalModuleResolutionCache.getPackageJsonInfoCache(),
          compilerHost,
          compilerOptions,
        ),
      )

    const toResolveModuleNameResult = (result: ResolveModuleNameResult): ResolveModuleNameResult => ({
      resolution: result.resolution,
      trace: result.trace,
    })

    const resolveAndRecordModuleName = (
      moduleName: string,
      containingFile: string,
      resolutionMode: ts.ModuleKind.ESNext | ts.ModuleKind.CommonJS | undefined,
      noDtsResolution: boolean | undefined,
      allowJs: boolean | undefined,
      moduleKey: string,
    ): ResolveModuleNameResult => {
      clearTraces()
      const { resolutionOptions, resolutionCache } = getResolutionContext(noDtsResolution, allowJs)
      const resolution = ts.resolveModuleName(
        moduleName,
        containingFile,
        resolutionOptions,
        compilerHost,
        resolutionCache,
        undefined,
        resolutionMode,
      )
      const trace = readTraces()
      recordModuleResolution(containingFile, moduleKey, resolution, trace)
      return {
        resolution,
        trace,
      }
    }

    const getResolutionContext = (
      noDtsResolution: boolean | undefined,
      allowJs: boolean | undefined,
    ): { resolutionOptions: ts.CompilerOptions; resolutionCache: ts.ModuleResolutionCache } => {
      if (noDtsResolution === true) {
        return {
          resolutionOptions: { ...compilerOptions, noDtsResolution, allowJs },
          resolutionCache: noDtsResolutionModuleResolutionCache,
        }
      }
      return {
        resolutionOptions: compilerOptions,
        resolutionCache: normalModuleResolutionCache,
      }
    }

    const recordModuleResolution = (
      containingFile: string,
      moduleKey: string,
      resolution: ts.ResolvedModuleWithFailedLookupLocations,
      trace: string[],
    ): void => {
      if (getCachedResolution(containingFile, moduleKey) === undefined) {
        storeModuleResolution(containingFile, moduleKey, { resolution, trace })
      }
    }

    const storeModuleResolution = (
      containingFile: string,
      moduleKey: string,
      result: ResolveModuleNameResult,
    ): void => {
      const entries = moduleResolutionCache[containingFile] ?? {}
      entries[moduleKey] = result
      moduleResolutionCache[containingFile] = entries
    }

    const resolveModuleName = (
      moduleName: string,
      containingFile: string,
      resolutionMode?: ts.ModuleKind.ESNext | ts.ModuleKind.CommonJS,
      noDtsResolution?: boolean,
      allowJs?: boolean,
    ): ResolveModuleNameResult => {
      const moduleKey = getModuleKey(moduleName, resolutionMode, noDtsResolution, allowJs)
      const cached = getCachedResolution(containingFile, moduleKey)
      if (cached !== undefined) {
        return toResolveModuleNameResult(cached)
      }
      return resolveAndRecordModuleName(moduleName, containingFile, resolutionMode, noDtsResolution, allowJs, moduleKey)
    }

    const createSourceFile = (path: ts.Path, fileName: string): ts.SourceFile | undefined => {
      const content = getSourceFileContent(fileName)
      if (content === undefined) {
        return undefined
      }
      return cacheSourceFile(path, fileName, content)
    }

    const getSourceFileContent = (fileName: string): string | undefined => {
      if (fileName === '/node_modules/typescript/lib/lib.d.ts') {
        return minimalLibDts
      }
      return pkg.tryReadFile(fileName)
    }

    const cacheSourceFile = (path: ts.Path, fileName: string, content: string): ts.SourceFile => {
      const sourceFile = ts.createSourceFile(
        fileName,
        content,
        {
          languageVersion,
          impliedNodeFormat: getImpliedNodeFormatForFile(fileName),
        },
        true,
      )
      MutableHashMap.set(sourceFileCache, path, sourceFile)
      return sourceFile
    }

    const createCompilerHostObject = (): ts.CompilerHost => ({
      fileExists: pkg.fileExists.bind(pkg),
      readFile: pkg.readFile.bind(pkg),
      directoryExists: pkg.directoryExists.bind(pkg),
      getSourceFile: (fileName) => {
        const path = toPath(fileName)
        const cachedOption = MutableHashMap.get(sourceFileCache, path)
        if (Option.isSome(cachedOption)) {
          return cachedOption.value
        }
        return createSourceFile(path, fileName)
      },
      getDefaultLibFileName: () => '/node_modules/typescript/lib/lib.d.ts',
      getCurrentDirectory: () => '/',
      writeFile: () => {
        throw new Error('Not implemented')
      },
      getCanonicalFileName,
      useCaseSensitiveFileNames: () => false,
      getNewLine: () => '\n',
      trace,
      resolveModuleNameLiterals: (
        moduleLiterals,
        containingFile,
        _redirectedReference,
        options,
        containingSourceFile,
      ) =>
        moduleLiterals.map(
          (literal) =>
            resolveModuleName(
              literal.text,
              containingFile,
              ts.getModeForUsageLocation(containingSourceFile, literal, compilerOptions),
              options.noDtsResolution,
            ).resolution,
        ),
    })

    compilerHost = createCompilerHostObject()

    const CompilerOptionsValueSchema = Schema.Union([
      Schema.String,
      Schema.Number,
      Schema.Boolean,
      Schema.Null,
      Schema.mutable(Schema.Array(Schema.String)),
    ])
    const ProgramKeySchema = Schema.Tuple([
      Schema.Array(Schema.String),
      Schema.Array(Schema.Tuple([Schema.String, CompilerOptionsValueSchema])),
    ])
    const programCache = yield* Cache.make<string, ts.Program>({
      capacity: 2,
      lookup: (key) =>
        Effect.gen(function*() {
          const [rootNames, entries] = yield* Schema.decodeEffect(Schema.fromJsonString(ProgramKeySchema))(key).pipe(
            Effect.orDie,
          )
          const options: ts.CompilerOptions = Object.fromEntries(entries)
          return ts.createProgram({
            rootNames: [...rootNames],
            options,
            host: compilerHost,
          })
        }),
    })

    const getProgram = (rootNames: readonly string[], options: ts.CompilerOptions): Effect.Effect<ts.Program> =>
      Cache.get(programCache, programKey(rootNames, options))

    const getCompilerOptions = (): ts.CompilerOptions => compilerOptions

    const getSourceFile = (fileName: string): ts.SourceFile | undefined =>
      compilerHost.getSourceFile(fileName, languageVersion)

    const getSourceFileFromCache = (fileName: string): ts.SourceFile | undefined =>
      Option.getOrUndefined(MutableHashMap.get(sourceFileCache, toPath(fileName)))

    const getModuleKindForFile = (fileName: string): ModuleKind | undefined => {
      const kind = getImpliedNodeFormatForFile(fileName)
      if (kind === undefined) {
        return undefined
      }
      return getDetectedModuleKind(fileName, kind)
    }

    const getDetectedModuleKind = (
      fileName: string,
      kind: ts.ModuleKind.ESNext | ts.ModuleKind.CommonJS,
    ): ModuleKind => {
      const isExtension = moduleExtensions.includes(ts.getAnyExtensionFromPath(fileName))
      const reasonPackageJsonInfo = getReasonPackageJsonInfo(fileName, isExtension)
      return {
        detectedKind: kind,
        detectedReason: getDetectedReason(isExtension, reasonPackageJsonInfo),
        reasonFileName: getReasonFileName(fileName, isExtension, reasonPackageJsonInfo),
      }
    }

    const getReasonPackageJsonInfo = (fileName: string, isExtension: boolean): ts.PackageJsonInfo | undefined => {
      if (isExtension) {
        return undefined
      }
      return getPackageScopeForPath(fileName)
    }

    const getReasonFileName = (
      fileName: string,
      isExtension: boolean,
      packageJsonInfo: ts.PackageJsonInfo | undefined,
    ): string => {
      if (isExtension) {
        return fileName
      }
      return getPackageJsonFileName(packageJsonInfo, fileName)
    }

    const getPackageJsonFileName = (packageJsonInfo: ts.PackageJsonInfo | undefined, fallback: string): string => {
      if (packageJsonInfo === undefined) {
        return fallback
      }
      return packageJsonInfo.packageDirectory + '/package.json'
    }

    const getDetectedReason = (
      isExtension: boolean,
      packageJsonInfo: ts.PackageJsonInfo | undefined,
    ): ModuleKindReason => {
      if (isExtension) {
        return 'extension'
      }
      return getPackageJsonReason(packageJsonInfo)
    }

    const getPackageJsonReason = (packageJsonInfo: ts.PackageJsonInfo | undefined): ModuleKindReason => {
      if (isNonEmptyString(getPackageJsonType(packageJsonInfo))) {
        return 'type'
      }
      return 'no:type'
    }

    const getPackageJsonType = (packageJsonInfo: ts.PackageJsonInfo | undefined): string | undefined =>
      packageJsonInfo?.contents.packageJsonContent.type

    const getTrace = (
      fromFileName: string,
      moduleSpecifier: string,
      resolutionMode: ts.ModuleKind.ESNext | ts.ModuleKind.CommonJS | undefined,
    ): string[] | undefined =>
      getCachedResolution(fromFileName, getModuleKey(moduleSpecifier, resolutionMode, undefined, undefined))?.trace

    const getResolvedModule = (
      sourceFile: ts.SourceFile,
      moduleName: string,
      resolutionMode: ts.ResolutionMode,
    ): ts.ResolvedModuleWithFailedLookupLocations | undefined =>
      getCachedResolution(sourceFile.fileName, getModuleKey(moduleName, resolutionMode, undefined, undefined))
        ?.resolution
    const createPrimaryProgram = (rootName: string): Effect.Effect<ts.Program> =>
      getProgram([rootName], compilerOptions)

    const createAuxiliaryProgram = (rootNames: string[]): Effect.Effect<ts.Program> =>
      getProgram(rootNames, compilerOptions)

    return {
      getCompilerOptions,
      getSourceFile,
      getSourceFileFromCache,
      getModuleKindForFile,
      resolveModuleName,
      getTrace,
      getResolvedModule,
      createPrimaryProgram,
      createAuxiliaryProgram,
    }
  })

function programKey(rootNames: readonly string[], options: ts.CompilerOptions): string {
  return JSON.stringify([rootNames, Object.entries(options).sort(([k1], [k2]) => k1.localeCompare(k2))])
}
