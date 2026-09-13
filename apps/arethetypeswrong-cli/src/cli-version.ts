import manifest from '../package.json'

/**
 * The version the bundler inlines from the manifest (`tsdown` replaces the
 * import), because the npm package ships no `package.json` for a runtime read.
 */
export const cliVersion: string = manifest.version
