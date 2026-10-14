/**
 * Just enough protobuf for the few messages the app answers for Anki's pages
 * (generic.String, generic.Bool, AskUserRequest, ...): read scalar fields by number,
 * write strings and bools. Field types beyond varint and length-delimited are skipped.
 */

export type Fields = Map<number, (number | Uint8Array)[]>

export function decode(bytes: Uint8Array): Fields {
  const out: Fields = new Map()
  let i = 0
  const varint = () => {
    let shift = 0
    let result = 0
    for (;;) {
      const b = bytes[i++]
      result += (b & 0x7f) * 2 ** shift
      if (b < 0x80) return result
      shift += 7
    }
  }
  while (i < bytes.length) {
    const key = varint()
    const field = Math.floor(key / 8)
    const wire = key & 7
    let value: number | Uint8Array
    if (wire === 0) value = varint()
    else if (wire === 2) {
      const len = varint()
      value = bytes.subarray(i, i + len)
      i += len
    } else if (wire === 1) {
      i += 8
      continue
    } else if (wire === 5) {
      i += 4
      continue
    } else break
    const list = out.get(field) ?? []
    list.push(value)
    out.set(field, list)
  }
  return out
}

const utf8 = new TextDecoder()

export function str(fields: Fields, n: number): string {
  const v = fields.get(n)?.[0]
  return v instanceof Uint8Array ? utf8.decode(v) : ''
}

export function strs(fields: Fields, n: number): string[] {
  return (fields.get(n) ?? []).filter((v): v is Uint8Array => v instanceof Uint8Array).map((v) => utf8.decode(v))
}

export function num(fields: Fields, n: number): number {
  const v = fields.get(n)?.[0]
  return typeof v === 'number' ? v : 0
}

export function sub(fields: Fields, n: number): Fields | null {
  const v = fields.get(n)?.[0]
  return v instanceof Uint8Array ? decode(v) : null
}

function writeVarint(out: number[], n: number) {
  while (n >= 0x80) {
    out.push((n & 0x7f) | 0x80)
    n = Math.floor(n / 128)
  }
  out.push(n)
}

/** A message of one string field 1 (generic.String). */
export function encodeString(s: string): Uint8Array {
  const data = new TextEncoder().encode(s)
  if (!data.length) return new Uint8Array()
  const out: number[] = [0x0a]
  writeVarint(out, data.length)
  return new Uint8Array([...out, ...data])
}

/** generic.Bool: false is the empty message. */
export function encodeBool(b: boolean): Uint8Array {
  return b ? new Uint8Array([0x08, 0x01]) : new Uint8Array()
}

export function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}
