/**
 * The bundle check (M-U2): `npm run build` ends here, and so does Vercel's build. It reads every
 * file the PWA ships (dist/) and fails the build if the accounts' server side shows up in it: the
 * Neon driver, PGlite, a secret's name, the code hash's tag or Neon's host. Those belong to api/ and
 * the dev scripts only; the phone only ever calls its own /api/auth.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const SERVER_ONLY = /neondatabase|pglite|DATABASE_URL|AUTH_COOKIE_KEY|AUTH_CODE_PEPPER|AUTH_BOOTSTRAP|kr-code-v1|neon\.tech/i
const SHIPPED = /\.(?:js|mjs|html|webmanifest|json|css)$/

/** Each shipped file that names something server-only, with what it named. */
export function scan(files: readonly { path: string; text: string }[]): string[] {
  const found: string[] = []
  for (const f of files) {
    if (!SHIPPED.test(f.path)) continue
    const m = SERVER_ONLY.exec(f.text)
    if (m) found.push(`${f.path}: ${m[0]}`)
  }
  return found
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

function main(): number {
  const dist = fileURLToPath(new URL('../dist', import.meta.url))
  const paths = walk(dist).filter((p) => SHIPPED.test(p))
  if (!paths.some((p) => p.endsWith('index.html'))) {
    process.stderr.write('Bundle check: dist/index.html is missing; build first.\n')
    return 1
  }
  const found = scan(paths.map((p) => ({ path: relative(dist, p), text: readFileSync(p, 'utf8') })))
  if (found.length > 0) {
    process.stderr.write(`Bundle check failed: server-only code or names in the PWA bundle:\n${found.map((f) => `  ${f}`).join('\n')}\n`)
    return 1
  }
  process.stdout.write(`Bundle check: ${paths.length} shipped files, none names the Neon driver, PGlite or an account secret.\n`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main()
