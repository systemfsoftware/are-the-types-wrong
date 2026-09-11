const dec = new TextDecoder()
const enc = new TextEncoder()

export const run = async (cmd: string, args: string[]) => {
  const out = await new Deno.Command(cmd, { args, stdout: 'piped', stderr: 'inherit' }).output()
  const stdout = dec.decode(out.stdout)
  if (!out.success) {
    if (stdout.length > 0) {
      Deno.stderr.writeSync(enc.encode(stdout.endsWith('\n') ? stdout : `${stdout}\n`))
    }
    throw new Error(`${cmd} ${args.join(' ')} failed (exit ${out.code})\n${stdout}`)
  }
  return stdout
}
