import { RoleIcon } from '@/components/ui/RoleIcon'
import { DEVICE_CATALOG, getModel, VENDOR_META } from '@/data/deviceCatalog'
import { useTopologyStore } from '@/store/useTopologyStore'
import type { DeviceNode } from '@/store/types'
import { ROLE_COLOR, ROLE_LABEL, ROLES } from '@/types/topology'
import { PortTable } from './PortTable'

export function DeviceInspector({ device }: { device: DeviceNode }) {
  const updateDevice = useTopologyStore((s) => s.updateDevice)
  const changeModel = useTopologyStore((s) => s.changeModel)
  const model = getModel(device.data.modelId)
  const accent = ROLE_COLOR[device.data.role]

  return (
    <div className="space-y-3.5">
      <header className="flex items-center gap-2">
        <span
          className="flex size-7 items-center justify-center rounded"
          style={{ background: accent, color: '#fff' }}
        >
          <RoleIcon role={device.data.role} size={15} />
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold">{device.data.hostname}</div>
          <div className="truncate text-[10.5px]" style={{ color: 'var(--muted)' }}>
            {model ? `${VENDOR_META[model.vendor].label} ${model.model}` : device.data.modelId}
          </div>
        </div>
      </header>

      <div>
        <label className="label" htmlFor="insp-hostname">
          Hostname
        </label>
        <input
          id="insp-hostname"
          className="field"
          value={device.data.hostname}
          onChange={(e) => updateDevice(device.id, { hostname: e.target.value })}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label" htmlFor="insp-role">
            Role
          </label>
          <select
            id="insp-role"
            className="field"
            value={device.data.role}
            onChange={(e) => updateDevice(device.id, { role: e.target.value as typeof device.data.role })}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="insp-site">
            Site / POP
          </label>
          <input
            id="insp-site"
            className="field"
            value={device.data.site}
            placeholder="POP-JKT-1"
            onChange={(e) => updateDevice(device.id, { site: e.target.value })}
          />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="insp-model">
          Model
        </label>
        <select
          id="insp-model"
          className="field"
          value={device.data.modelId}
          onChange={(e) => changeModel(device.id, e.target.value)}
        >
          {DEVICE_CATALOG.map((m) => (
            <option key={m.id} value={m.id}>
              {VENDOR_META[m.vendor].label} — {m.model}
            </option>
          ))}
        </select>
        <p className="mt-1 text-[10px]" style={{ color: 'var(--muted)' }}>
          Ganti model akan membuat ulang daftar port; hanya bisa saat perangkat belum punya link.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label" htmlFor="insp-mgmt">
            IP Manajemen
          </label>
          <input
            id="insp-mgmt"
            className="field font-mono"
            value={device.data.mgmtIp}
            placeholder="10.10.0.1"
            onChange={(e) => updateDevice(device.id, { mgmtIp: e.target.value })}
          />
        </div>
        <div>
          <label className="label" htmlFor="insp-loop">
            Loopback
          </label>
          <input
            id="insp-loop"
            className="field font-mono"
            value={device.data.loopback}
            placeholder="10.255.0.1"
            onChange={(e) => updateDevice(device.id, { loopback: e.target.value })}
          />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="insp-notes">
          Catatan
        </label>
        <textarea
          id="insp-notes"
          className="field h-16 resize-none"
          value={device.data.notes}
          onChange={(e) => updateDevice(device.id, { notes: e.target.value })}
        />
      </div>

      <PortTable device={device} />
    </div>
  )
}
