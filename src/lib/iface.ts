import { PORT_MODE_BADGE, type PortMode } from '@/types/topology'
import { formatVlanList, parseVlanList, summarizeVlans } from './vlans'

export interface IfaceConfig {
  linkType: PortMode
  pvid: number | null
  allowedVlans: string
  untaggedVlans: string
  ipAddress: string
}

/** Badge pendek di node: A100 / T / H / L3 */
export function ifaceBadge(c: IfaceConfig): string {
  if (c.linkType === 'access') return c.pvid ? `A${c.pvid}` : 'A'
  return PORT_MODE_BADGE[c.linkType]
}

/** Keterangan lengkap gaya CLI, untuk tooltip dan ekspor. */
export function ifaceSummary(c: IfaceConfig): string {
  switch (c.linkType) {
    case 'access':
      return c.pvid ? `access vlan ${c.pvid}` : 'access (VLAN belum diisi)'
    case 'trunk': {
      const tagged = summarizeVlans(c.allowedVlans, 6)
      return [`trunk`, c.pvid ? `pvid ${c.pvid}` : null, tagged ? `tagged ${tagged}` : null]
        .filter(Boolean)
        .join(' · ')
    }
    case 'hybrid': {
      const tagged = summarizeVlans(c.allowedVlans, 6)
      const untagged = summarizeVlans(c.untaggedVlans, 6)
      return [
        'hybrid',
        c.pvid ? `pvid ${c.pvid}` : null,
        tagged ? `tagged ${tagged}` : null,
        untagged ? `untagged ${untagged}` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    }
    case 'routed':
      return c.ipAddress ? `routed ${c.ipAddress}` : 'routed (IP belum diisi)'
    default:
      return ''
  }
}

/** Ringkasan VLAN untuk label di kabel: "vl 100" / "vl 1,100,200" / "9 vlan". */
export function ifaceVlanLabel(c: IfaceConfig): string {
  if (c.linkType === 'access') return c.pvid ? `vl ${c.pvid}` : ''
  if (c.linkType === 'routed') return c.ipAddress
  const vlans = ifaceVlans(c)
  if (vlans.length === 0) return ''
  return vlans.length <= 3 ? `vl ${formatVlanList(vlans)}` : `${vlans.length} vlan`
}

/** Semua VLAN yang lewat interface ini — dipakai membandingkan dua ujung link. */
export function ifaceVlans(c: IfaceConfig): number[] {
  if (c.linkType === 'access') return c.pvid ? [c.pvid] : []
  if (c.linkType === 'routed' || c.linkType === 'none') return []
  const tagged = parseVlanList(c.allowedVlans)
  const untagged = parseVlanList(c.untaggedVlans)
  const out = new Set<number>()
  if (tagged.ok) for (const v of tagged.vlans) out.add(v)
  if (untagged.ok) for (const v of untagged.vlans) out.add(v)
  if (c.pvid) out.add(c.pvid)
  return [...out].sort((a, b) => a - b)
}

export const vlanListText = (vlans: number[]): string => formatVlanList(vlans)
