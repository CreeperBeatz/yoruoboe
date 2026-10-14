/**
 * What Anki's generated backend.ts calls for every method. Anki's version
 * POSTs to the desktop app's web server; here the call goes to the engine's
 * worker.
 */

import { callRaw } from './client'

export interface PostProtoOptions {
  /** Kept for the generated code's signature; errors are always thrown. */
  alertOnError?: boolean
  signal?: AbortSignal
}

export async function postProto<T>(
  method: string,
  input: { toBinary(): Uint8Array },
  outputType: { fromBinary(arr: Uint8Array): T },
  _options: PostProtoOptions = {},
  _opChangesType = 0,
): Promise<T> {
  const out = await callRaw(method, input.toBinary())
  return outputType.fromBinary(out)
}
