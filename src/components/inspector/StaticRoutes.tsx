import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { formatCidr, networkOf, parseCidr, parseIp } from '@/lib/ip'
import { useTopologyStore } from '@/store/useTopologyStore'
import type { DeviceNode } from '@/store/types'

/**
 * Rute statis perangkat — data yang sama dengan `ip route-static` / `ip route`
 * / `set routing-options static` di CLI. Simulasi ping memakai daftar ini
 * untuk meneruskan paket lebih dari satu hop.
 */
export function StaticRoutes({ device }: { device: DeviceNode }) {
  const updateDevice = useTopologyStore((s) => s.updateDevice)
  const [prefix, setPrefix] = useState('')
  const [nextHop, setNextHop] = useState('')
  const routes = device.data.staticRoutes

  const dest = parseCidr(prefix.includes('/') ? prefix : prefix ? `${prefix}/32` : '')
  const nh = parseIp(nextHop)
  const valid = dest !== null && nh !== null
  const normalized = dest ? formatCidr({ addr: networkOf(dest), prefix: dest.prefix }) : ''
  const duplicate = routes.some((r) => r.prefix === normalized && r.nextHop === nextHop.trim())

  const add = () => {
    if (!valid || duplicate) return
    updateDevice(device.id, { staticRoutes: [...routes, { prefix: normalized, nextHop: nextHop.trim() }] })
    setPrefix('')
    setNextHop('')
  }

  return (
    <section>
      <span className="label">Rute statis ({routes.length})</span>
      {routes.length > 0 ? (
        <ul className="mb-1.5 space-y-1">
          {routes.map((r, i) => (
            <li
              key={`${r.prefix}-${r.nextHop}`}
              className="flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[11px]"
              style={{ borderColor: 'var(--border)', background: 'var(--panel-2)' }}
            >
              <span className="min-w-0 flex-1 truncate">
                {r.prefix} <span style={{ color: 'var(--muted)' }}>via</span> {r.nextHop}
              </span>
              <button
                type="button"
                className="btn shrink-0 px-1 py-0.5"
                style={{ color: '#ef4444' }}
                title="Hapus rute"
                onClick={() => updateDevice(device.id, { staticRoutes: routes.filter((_, k) => k !== i) })}
              >
                <Trash2 size={11} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex items-center gap-1">
        <input
          className="field min-w-0 flex-1 px-1.5 py-1 font-mono text-[11px]"
          placeholder="0.0.0.0/0"
          aria-label="Tujuan rute"
          value={prefix}
          onChange={(e) => setPrefix(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <input
          className="field min-w-0 flex-1 px-1.5 py-1 font-mono text-[11px]"
          placeholder="next-hop"
          aria-label="Next-hop"
          value={nextHop}
          onChange={(e) => setNextHop(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button
          type="button"
          className="btn shrink-0 px-1.5 py-1"
          disabled={!valid || duplicate}
          title={duplicate ? 'Rute ini sudah ada' : 'Tambah rute statis'}
          onClick={add}
        >
          <Plus size={11} />
        </button>
      </div>
    </section>
  )
}
