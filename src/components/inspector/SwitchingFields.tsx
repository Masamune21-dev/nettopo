import { parseVlanList } from '@/lib/vlans'
import {
  PORT_MODE_COLOR,
  PORT_MODE_LABEL,
  PORT_MODES,
  type PortMode,
} from '@/types/topology'

export interface SwitchingValue {
  linkType: PortMode
  pvid: number | null
  allowedVlans: string
  untaggedVlans: string
  ipAddress: string
}

/** Kotak teks VLAN yang memberi tanda merah kalau isinya bukan daftar yang sah. */
function VlanInput({
  value,
  placeholder,
  ariaLabel,
  onChange,
}: {
  value: string
  placeholder: string
  ariaLabel: string
  onChange: (v: string) => void
}) {
  const parsed = parseVlanList(value)
  const bad = !parsed.ok
  return (
    <input
      className="field min-w-0 flex-1 px-1 py-0.5 font-mono text-[10.5px]"
      style={bad ? { borderColor: '#ef4444', color: '#ef4444' } : undefined}
      placeholder={placeholder}
      aria-label={ariaLabel}
      title={bad ? parsed.error : `${parsed.vlans.length} VLAN`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

/**
 * Baris pengaturan VLAN / L3 sebuah interface. Field yang tampil mengikuti
 * link-type-nya, persis seperti konfigurasi di perangkat aslinya.
 */
export function SwitchingFields({
  value,
  onChange,
  compact = true,
}: {
  value: SwitchingValue
  onChange: (patch: Partial<SwitchingValue>) => void
  compact?: boolean
}) {
  const { linkType } = value

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      <select
        className="field w-[104px] shrink-0 px-1 py-0.5 text-[10.5px]"
        style={{ color: PORT_MODE_COLOR[linkType] }}
        value={linkType}
        aria-label="Link-type interface"
        onChange={(e) => onChange({ linkType: e.target.value as PortMode })}
      >
        {PORT_MODES.map((m) => (
          <option key={m} value={m}>
            {compact ? PORT_MODE_LABEL[m].split(' ')[0] : PORT_MODE_LABEL[m]}
          </option>
        ))}
      </select>

      {linkType === 'access' || linkType === 'trunk' || linkType === 'hybrid' ? (
        <input
          className="field w-[74px] shrink-0 px-1 py-0.5 font-mono text-[10.5px]"
          type="number"
          min={1}
          max={4094}
          placeholder={linkType === 'access' ? 'vlan' : 'pvid'}
          aria-label={linkType === 'access' ? 'VLAN access' : 'Native VLAN / PVID'}
          title={linkType === 'access' ? 'VLAN access' : 'Native VLAN (PVID)'}
          value={value.pvid ?? ''}
          onChange={(e) => onChange({ pvid: e.target.value === '' ? null : Number(e.target.value) })}
        />
      ) : null}

      {linkType === 'trunk' || linkType === 'hybrid' ? (
        <VlanInput
          value={value.allowedVlans}
          placeholder="tagged: 100,200,300-310"
          ariaLabel="VLAN bertag"
          onChange={(v) => onChange({ allowedVlans: v })}
        />
      ) : null}

      {linkType === 'hybrid' ? (
        <VlanInput
          value={value.untaggedVlans}
          placeholder="untagged"
          ariaLabel="VLAN untagged"
          onChange={(v) => onChange({ untaggedVlans: v })}
        />
      ) : null}

      {linkType === 'routed' ? (
        <input
          className="field min-w-0 flex-1 px-1 py-0.5 font-mono text-[10.5px]"
          placeholder="10.0.0.1/30"
          aria-label="Alamat IP interface"
          value={value.ipAddress}
          onChange={(e) => onChange({ ipAddress: e.target.value })}
        />
      ) : null}
    </div>
  )
}
