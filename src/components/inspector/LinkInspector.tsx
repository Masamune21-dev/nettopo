import { ArrowLeftRight, Spline } from 'lucide-react'
import { useTopologyStore } from '@/store/useTopologyStore'
import type { AppEdge, DeviceNode } from '@/store/types'
import { isDeviceNode } from '@/store/types'
import { summarizeTrunk } from '@/lib/trunks'
import {
  LINK_KINDS,
  LINK_MEDIA,
  ROUTING_LABEL,
  ROUTING_MODES,
  SPEED_COLOR,
  SPEEDS,
} from '@/types/topology'

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
  handleId,
  onChange,
}: {
  title: string
  device: DeviceNode | undefined
  handleId: string | null | undefined
  onChange: (handleId: string) => void
}) {
  const trunk = device?.data.trunks.find((t) => t.id === handleId)
  const summary = trunk && device ? summarizeTrunk(trunk, device.data.ports) : null
  // Port yang sudah jadi anggota trunk tidak boleh dipilih sebagai ujung link.
  const memberIds = new Set(device?.data.trunks.flatMap((t) => t.memberIds) ?? [])

  return (
    <div>
      <span className="label">{title}</span>
      <div className="rounded-md border p-1.5" style={{ borderColor: 'var(--border)' }}>
        <div className="truncate text-[12px] font-medium">{device?.data.hostname ?? '—'}</div>
        <select
          className="field mt-1 font-mono text-[11px]"
          value={handleId ?? ''}
          aria-label={`Interface ${title}`}
          onChange={(e) => onChange(e.target.value)}
        >
          {device && device.data.trunks.length > 0 ? (
            <optgroup label="Trunk / bonding">
              {device.data.trunks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} · {summarizeTrunk(t, device.data.ports).composition}
                </option>
              ))}
            </optgroup>
          ) : null}
          <optgroup label="Port fisik">
            {device?.data.ports
              .filter((p) => !memberIds.has(p.id))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.speed}
                </option>
              ))}
          </optgroup>
        </select>
        {trunk && summary ? (
          <div className="mt-1 text-[10px]" style={{ color: 'var(--muted)' }}>
            {trunk.mode === 'lacp' ? 'LACP' : 'Static'} · {summary.label} ·{' '}
            {trunk.memberIds
              .map((id) => device?.data.ports.find((p) => p.id === id)?.name)
              .filter(Boolean)
              .join(', ')}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function LinkInspector({ edge }: { edge: AppEdge }) {
  const nodes = useTopologyStore((s) => s.nodes)
  const updateLink = useTopologyStore((s) => s.updateLink)
  const flipLink = useTopologyStore((s) => s.flipLink)
  const setLinkEndpoint = useTopologyStore((s) => s.setLinkEndpoint)
  const straightenLink = useTopologyStore((s) => s.straightenLink)

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
        handleId={edge.sourceHandle}
        onChange={(handleId) => setLinkEndpoint(edge.id, 'a', handleId)}
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
        handleId={edge.targetHandle}
        onChange={(handleId) => setLinkEndpoint(edge.id, 'b', handleId)}
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
        <label className="label" htmlFor="lnk-routing">
          Gaya kabel
        </label>
        <select
          id="lnk-routing"
          className="field"
          value={data?.routing ?? 'bezier'}
          onChange={(e) => updateLink(edge.id, { routing: e.target.value as never })}
        >
          {ROUTING_MODES.map((r) => (
            <option key={r} value={r}>
              {ROUTING_LABEL[r]}
            </option>
          ))}
        </select>
        <div className="mt-1 flex items-center gap-2">
          <span className="flex-1 text-[10px]" style={{ color: 'var(--muted)' }}>
            {data?.waypoints.length
              ? `${data.waypoints.length} titik belok`
              : 'Pilih kabel di kanvas, lalu klik titik kecil di tengahnya untuk membelokkan.'}
          </span>
          {data?.waypoints.length ? (
            <button
              type="button"
              className="btn shrink-0 px-1.5 py-0.5 text-[11px]"
              onClick={() => straightenLink(edge.id)}
            >
              <Spline size={11} /> Luruskan
            </button>
          ) : null}
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
