import { ArrowLeftRight } from 'lucide-react'
import { useTopologyStore } from '@/store/useTopologyStore'
import type { AppEdge, DeviceNode } from '@/store/types'
import { isDeviceNode } from '@/store/types'
import { LINK_KINDS, LINK_MEDIA, SPEED_COLOR, SPEEDS } from '@/types/topology'

const KIND_LABEL: Record<(typeof LINK_KINDS)[number], string> = {
  single: 'Single link',
  lacp: 'LACP / bundle',
  backup: 'Backup / standby',
}

const MEDIA_LABEL: Record<(typeof LINK_MEDIA)[number], string> = {
  fiber: 'Fiber',
  copper: 'Copper (UTP)',
  wireless: 'Wireless',
  virtual: 'Virtual / logical',
}

function EndpointRow({
  title,
  device,
  portId,
  onChange,
}: {
  title: string
  device: DeviceNode | undefined
  portId: string | null | undefined
  onChange: (portId: string) => void
}) {
  return (
    <div>
      <span className="label">{title}</span>
      <div className="rounded-md border p-1.5" style={{ borderColor: 'var(--border)' }}>
        <div className="truncate text-[12px] font-medium">{device?.data.hostname ?? '—'}</div>
        <select
          className="field mt-1 font-mono text-[11px]"
          value={portId ?? ''}
          onChange={(e) => onChange(e.target.value)}
        >
          {device?.data.ports.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.speed}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

export function LinkInspector({ edge }: { edge: AppEdge }) {
  const nodes = useTopologyStore((s) => s.nodes)
  const updateLink = useTopologyStore((s) => s.updateLink)
  const flipLink = useTopologyStore((s) => s.flipLink)
  const setLinkEndpoint = useTopologyStore((s) => s.setLinkEndpoint)

  const deviceOf = (id: string) => nodes.find((n): n is DeviceNode => n.id === id && isDeviceNode(n))
  const a = deviceOf(edge.source)
  const b = deviceOf(edge.target)
  const data = edge.data

  return (
    <div className="space-y-3.5">
      <header className="flex items-center gap-2">
        <span
          className="h-1.5 w-7 rounded-full"
          style={{ background: data?.color ?? SPEED_COLOR[data?.speed ?? '1G'] }}
        />
        <div className="text-[13px] font-semibold">Link {data?.speed}</div>
      </header>

      <EndpointRow
        title="Sisi A"
        device={a}
        portId={edge.sourceHandle}
        onChange={(portId) => setLinkEndpoint(edge.id, 'a', portId)}
      />

      <button
        type="button"
        className="btn w-full justify-center"
        onClick={() => flipLink(edge.id)}
        title="Tukar sisi A dan B"
      >
        <ArrowLeftRight size={13} /> Tukar A ↔ B
      </button>

      <EndpointRow
        title="Sisi B"
        device={b}
        portId={edge.targetHandle}
        onChange={(portId) => setLinkEndpoint(edge.id, 'b', portId)}
      />

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label" htmlFor="lnk-speed">
            Kecepatan
          </label>
          <select
            id="lnk-speed"
            className="field"
            value={data?.speed ?? '1G'}
            onChange={(e) => updateLink(edge.id, { speed: e.target.value as never })}
          >
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="lnk-media">
            Media
          </label>
          <select
            id="lnk-media"
            className="field"
            value={data?.media ?? 'fiber'}
            onChange={(e) => updateLink(edge.id, { media: e.target.value as never })}
          >
            {LINK_MEDIA.map((m) => (
              <option key={m} value={m}>
                {MEDIA_LABEL[m]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="label" htmlFor="lnk-kind">
          Jenis
        </label>
        <select
          id="lnk-kind"
          className="field"
          value={data?.kind ?? 'single'}
          onChange={(e) => updateLink(edge.id, { kind: e.target.value as never })}
        >
          {LINK_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label" htmlFor="lnk-vlan">
            VLAN
          </label>
          <input
            id="lnk-vlan"
            className="field font-mono"
            placeholder="100,200"
            value={data?.vlans ?? ''}
            onChange={(e) => updateLink(edge.id, { vlans: e.target.value })}
          />
        </div>
        <div>
          <label className="label" htmlFor="lnk-color">
            Warna
          </label>
          <div className="flex items-center gap-1.5">
            <input
              id="lnk-color"
              type="color"
              className="h-[30px] w-10 cursor-pointer rounded border"
              style={{ borderColor: 'var(--border)', background: 'var(--panel-2)' }}
              value={data?.color ?? SPEED_COLOR[data?.speed ?? '1G']}
              onChange={(e) => updateLink(edge.id, { color: e.target.value })}
            />
            <button
              type="button"
              className="btn flex-1 justify-center px-1"
              onClick={() => updateLink(edge.id, { color: null })}
              title="Kembali ke warna otomatis menurut kecepatan"
            >
              Auto
            </button>
          </div>
        </div>
      </div>

      <div>
        <label className="label" htmlFor="lnk-label">
          Label
        </label>
        <input
          id="lnk-label"
          className="field"
          placeholder="Core ↔ SSW"
          value={data?.label ?? ''}
          onChange={(e) => updateLink(edge.id, { label: e.target.value })}
        />
      </div>
    </div>
  )
}
