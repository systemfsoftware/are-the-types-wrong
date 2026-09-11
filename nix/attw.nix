# attw, the arethetypeswrong CLI, built from this repository.
#
# The CLI is a self-contained program: tsdown inlines every runtime dependency
# (effect, @effect/platform-node, the engine, typescript) into one ESM file, so
# the result is Node plus a single .mjs and nothing else. pnpm exists only to
# put the build toolchain in place. Each lockfile package is fetched by its own
# integrity field, so the lockfile is the only pin — a lockfile bump does not
# need a second store-wide hash.
{
  lib,
  stdenvNoCC,
  nodejs_24,
  pnpm_11,
  importPnpmLock,
  iplConfigHook,
  makeWrapper,
}:

let
  manifest = lib.importJSON ../apps/arethetypeswrong-cli/package.json;

  # The bundle inlines everything it imports, so the only things that must be
  # reachable are the sources and the workspace manifests pnpm resolves against.
  # Build artefacts and caches are excluded so the derivation's input is a
  # function of the lockfile, not of whatever a developer left in the tree.
  source = lib.cleanSourceWith {
    src = ../.;
    filter =
      path: _type:
      let
        base = baseNameOf path;
      in
      !(builtins.elem base [
        "node_modules"
        ".git"
        ".turbo"
        ".direnv"
        "dist"
        "coverage"
        "reports"
      ])
      && !(lib.hasSuffix ".tsbuildinfo" base);
  };
in
stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "attw";
  version = manifest.version;

  src = source;

  mitmCache = importPnpmLock {
    inherit (finalAttrs) pname version;
    lockFile = ../pnpm-lock.yaml;
  };

  nativeBuildInputs = [
    nodejs_24
    pnpm_11
    iplConfigHook
    makeWrapper
  ];

  buildPhase = ''
    runHook preBuild
    pnpm --filter @systemfsoftware/arethetypeswrong run build
    pnpm --filter @systemfsoftware/arethetypeswrong-cli run build
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    install -Dm644 apps/arethetypeswrong-cli/dist/main.mjs "$out/lib/attw/main.mjs"

    # `attw` is Node executing a script; `env node` would silently depend on the
    # caller's PATH, so the interpreter is pinned to this build's Node. `--pack`
    # also shells out to `npm pack`, and npm ships with that same Node.
    makeWrapper ${nodejs_24}/bin/node "$out/bin/attw" \
      --add-flags "$out/lib/attw/main.mjs" \
      --prefix PATH : ${lib.makeBinPath [ nodejs_24 ]}

    runHook postInstall
  '';

  meta = {
    description = "Analyze npm package contents for TypeScript type resolution issues";
    homepage = "https://github.com/systemfsoftware/are-the-types-wrong";
    license = lib.licenses.asl20;
    mainProgram = "attw";
    platforms = [
      "x86_64-linux"
      "aarch64-linux"
      "x86_64-darwin"
      "aarch64-darwin"
    ];
  };
})
