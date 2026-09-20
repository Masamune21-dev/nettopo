export const MIN_VLAN = 1
export const MAX_VLAN = 4094

export type VlanParse =
  | { ok: true; vlans: number[] }
  | { ok: false; error: string }

/**
 * Baca daftar VLAN gaya CLI: "100,200,300-310" atau "100 200 4000".
 * Pemisah boleh koma atau spasi; rentang memakai tanda hubung.
 */
export function parseVlanList(input: string): VlanParse {
  const text = input.trim()
  if (!text) return { ok: true, vlans: [] }

  const out = new Set<number>()
  for (const token of text.split(/[,\s]+/).filter(Boolean)) {
    const range = /^(\d{1,4})\s*-\s*(\d{1,4})$/.exec(token)
    const single = /^(\d{1,4})$/.exec(token)

    if (range) {
      const from = Number(range[1])
      const to = Number(range[2])
      if (!inRange(from) || !inRange(to)) return { ok: false, error: `VLAN "${token}" di luar ${MIN_VLAN}–${MAX_VLAN}` }
      if (from > to) return { ok: false, error: `Rentang "${token}" terbalik` }
      for (let v = from; v <= to; v += 1) out.add(v)
      continue
    }

    if (single) {
      const v = Number(single[1])
      if (!inRange(v)) return { ok: false, error: `VLAN "${token}" di luar ${MIN_VLAN}–${MAX_VLAN}` }
      out.add(v)
      continue
    }

    return { ok: false, error: `"${token}" bukan VLAN atau rentang yang sah` }
  }

  return { ok: true, vlans: [...out].sort((a, b) => a - b) }
}

const inRange = (v: number) => Number.isInteger(v) && v >= MIN_VLAN && v <= MAX_VLAN

/** Kebalikan parseVlanList: [100,101,102,200] → "100-102,200" */
export function formatVlanList(vlans: number[]): string {
  const sorted = [...new Set(vlans)].sort((a, b) => a - b)
  const parts: string[] = []
  let i = 0
  while (i < sorted.length) {
    const start = sorted[i] as number
    let end = start
    while (i + 1 < sorted.length && sorted[i + 1] === end + 1) {
      i += 1
      end = sorted[i] as number
    }
    parts.push(end > start + 1 ? `${start}-${end}` : end === start + 1 ? `${start},${end}` : `${start}`)
    i += 1
  }
  return parts.join(',')
}

/** Jumlah VLAN dalam sebuah daftar; 0 bila kosong atau tidak sah. */
export function vlanCount(input: string): number {
  const parsed = parseVlanList(input)
  return parsed.ok ? parsed.vlans.length : 0
}

/** Ringkasan pendek untuk label di kanvas: "100,200" atau "12 vlan". */
export function summarizeVlans(input: string, maxShown = 3): string {
  const parsed = parseVlanList(input)
  if (!parsed.ok || parsed.vlans.length === 0) return ''
  if (parsed.vlans.length <= maxShown) return formatVlanList(parsed.vlans)
  return `${parsed.vlans.length} vlan`
}

/** VLAN yang ada di a tapi tidak di b — untuk membandingkan dua ujung link. */
export function vlansMissingFrom(a: string, b: string): number[] {
  const pa = parseVlanList(a)
  const pb = parseVlanList(b)
  if (!pa.ok || !pb.ok) return []
  const setB = new Set(pb.vlans)
  return pa.vlans.filter((v) => !setB.has(v))
}
