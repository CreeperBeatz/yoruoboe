/**
 * The app's API, answered in the browser. The screens call `/api/...` as they did when
 * a server answered (see ../api.ts); the handlers registered here answer from the
 * collection on this device, through Anki's engine.
 */

import { BackendError, ErrorKind } from '../engine/client'

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export interface Ctx {
  params: Record<string, string>
  query: URLSearchParams
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any
}

type Handler = (ctx: Ctx) => unknown

interface Route {
  method: string
  re: RegExp
  keys: string[]
  handler: Handler
}

const routes: Route[] = []

/** Register a handler; `:name` in the pattern matches one path segment. */
export function route(method: string, pattern: string, handler: Handler) {
  const keys: string[] = []
  const re = new RegExp(
    '^' +
      pattern.replace(/:(\w+)/g, (_, k) => {
        keys.push(k)
        return '([^/]+)'
      }) +
      '$',
  )
  routes.push({ method, re, keys, handler })
}

export const get = (p: string, h: Handler) => route('GET', p, h)
export const post = (p: string, h: Handler) => route('POST', p, h)
export const put = (p: string, h: Handler) => route('PUT', p, h)
export const del = (p: string, h: Handler) => route('DELETE', p, h)

/** Answer a request. Throws HttpError with the status a server would have sent. */
export async function handle(method: string, url: string, body: unknown): Promise<unknown> {
  const u = new URL(url, location.origin)
  let pathMatched = false
  for (const r of routes) {
    const m = r.re.exec(u.pathname)
    if (!m) continue
    pathMatched = true
    if (r.method !== method) continue
    const params: Record<string, string> = {}
    r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])))
    try {
      return await r.handler({ params, query: u.searchParams, body })
    } catch (err) {
      throw asHttpError(err)
    }
  }
  throw new HttpError(pathMatched ? 405 : 404, `${method} ${u.pathname} not found`)
}

function asHttpError(err: unknown): HttpError {
  if (err instanceof HttpError) return err
  if (err instanceof BackendError) {
    const status = err.kind === ErrorKind.NOT_FOUND_ERROR ? 404 : err.kind === ErrorKind.EXISTS ? 409 : 400
    return new HttpError(status, err.message)
  }
  return new HttpError(500, err instanceof Error ? err.message : String(err))
}

/** Numbers in, numbers out: the engine's ids are 64-bit (bigint in protobuf-es). */
export const big = (n: number | string | bigint) => BigInt(n)
export const num = (b: bigint | number) => Number(b)
export const bigs = (ns: (number | string)[]) => ns.map((n) => BigInt(n))
export const nums = (bs: (bigint | number)[]) => bs.map((b) => Number(b))
