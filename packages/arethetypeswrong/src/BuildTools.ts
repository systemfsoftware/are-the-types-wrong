import { type BuildTool, BuildToolSchema } from './Analysis.schema.js'

export const allBuildTools: readonly BuildTool[] = [...BuildToolSchema.literals]

export const getBuildTools = (packageJson: {
  devDependencies?: Record<string, string>
}): Partial<Record<BuildTool, string>> => selectBuildTools(packageJson.devDependencies)

function isBuildTool(name: string): name is BuildTool {
  return allBuildTools.some((tool) => tool === name)
}

function selectBuildTools(devDependencies: Record<string, string> | undefined): Partial<Record<BuildTool, string>> {
  const selected: Partial<Record<BuildTool, string>> = {}
  if (devDependencies === undefined) {
    return selected
  }
  Object.entries(devDependencies).forEach(([name, version]) => {
    if (isBuildTool(name)) {
      selected[name] = version
    }
  })
  return selected
}
