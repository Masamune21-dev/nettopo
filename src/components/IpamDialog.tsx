import { useReactFlow } from '@xyflow/react'
import { Download, Wand2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Dialog } from '@/components/Dialog'
import { downloadText, slugify } from '@/lib/download'
import { formatCidr, formatIp, nextFreeSubnet, parseCidr, usableRange } from '@/lib/ip'
import { analyzeIpam, subnetLabel, takenSubnets } from '@/lib/ipam'
import { useTopologyStore } from '@/store/useTopologyStore'
import { useUiStore } from '@/store/useUiStore'

const POOL_KEY = 'nettopo:ip-pool'
const PREFIX_KEY = 'nettopo:ip-prefix'

export function IpamDialog() {
  const open = useUiStore((s) => s.ipamOpen)
  const setUi = useUiStore((s) => s.set)
  const nodes = useTopologyStore((s) => s.nodes)
  const edges = useTopologyStore((s) => s.edges)
  const assignLinkAddresses = useTopologyStore((s) => s.assignLinkAddresses)
  const pushToast = useTopologyStore((s) => s.pushToast)
  const projectName = useTopologyStore((s) => s.projectName)
  const { setCenter } = useReactFlow()

  const [pool, setPool] = useState(() => localStorage.getItem(POOL_KEY) ?? '10.0.0.0/16')
  const [prefix, setPrefix] = useState(() => Number(localStorage.getItem(PREFIX_KEY) ?? 30))

  const report = useMemo(() => analyzeIpam(nodes, edges), [nodes, edges])
  const poolCidr = parseCidr(pool)

  if (!open) return null

  const assignAll = () => {
    if (!poolCidr) {
      pushToast('Blok alamat tidak sah — contoh yang benar: 10.0.0.0/16', 'warn')
      return
    }
    // Setiap pemberian menambah blok terpakai, jadi daftarnya ikut tumbuh.
    const taken = takenSubnets(report)
    let done = 0
    let full = false

    for (const link of report.unaddressed) {
      const block = nextFreeSubnet(poolCidr, prefix, taken)
      if (!block) {
        full = true
        break
      }
      const { first, last } = usableRange(block)
      assignLinkAddresses(link.edgeId, `${formatIp(first)}/${prefix}`, `${formatIp(last)}/${prefix}`)
      taken.push(block)
      done += 1
    }

    if (done === 0 && !full) pushToast('Tidak ada link L3 yang menunggu alamat.', 'info')
    else if (full) pushToast(`${done} link diberi alamat; blok ${pool} sudah habis.`, 'warn')
    else pushToast(`${done} link diberi alamat /${prefix}. Cmd/Ctrl+Z membatalkan.`, 'ok')
  }

  const exportPlan = () => {
    const rows = [
      ['subnet', 'kapasitas', 'terpakai', 'hostname', 'interface', 'alamat'],
      ...report.subnets.flatMap((s) =>
        s.members.map((m) => [
          formatCidr(s.network),
          String(s.capacity),
          String(s.members.length),
          m.hostname,
          m.ifaceName,
          formatCidr(m.cidr),
        ]),
      ),
    ]
    const csv = rows
      .map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(','))
      .join('\n')
    downloadText(csv, `${slugify(projectName)}-alamat-ip.csv`, 'text/csv')
  }

  const focus = (deviceId: string) => {
    const n = nodes.find((x) => x.id === deviceId)
    if (!n) return
    setCenter(n.position.x + (n.measured?.width ?? 240) / 2, n.position.y + (n.measured?.height ?? 140) / 2, {
      zoom: 1.1,
      duration: 400,
    })
  }

  return (
    <Dialog title="Alamat IP" onClose={() => setUi('ipamOpen', false)} width={720}>
      <div className="space-y-4">
        {/* Pemberian otomatis */}
        <section>
          <span className="label">Beri alamat otomatis</span>
          <div className="flex flex-wrap items-end gap-1.5">
            <div className="min-w-[160px] flex-1">
              <label className="label mb-0.5 normal-case" htmlFor="ipam-pool">
                Blok alamat
              </label>
              <input
                id="ipam-pool"
                className="field font-mono"
                value={pool}
                placeholder="10.0.0.0/16"
                style={!poolCidr && pool ? { borderColor: '#ef4444', color: '#ef4444' } : undefined}
                onChange={(e) => {
                  setPool(e.target.value)
                  localStorage.setItem(POOL_KEY, e.target.value)
                }}
              />
            </div>
            <div>
              <label className="label mb-0.5 normal-case" htmlFor="ipam-prefix">
                Ukuran per link
              </label>
              <select
                id="ipam-prefix"
                className="field w-[110px]"
                value={prefix}
                onChange={(e) => {
                  setPrefix(Number(e.target.value))
                  localStorage.setItem(PREFIX_KEY, e.target.value)
                }}
              >
                <option value={30}>/30 (2 host)</option>
                <option value={31}>/31 (RFC 3021)</option>
                <option value={29}>/29 (6 host)</option>
              </select>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={assignAll}
              disabled={report.unaddressed.length === 0}
            >
              <Wand2 size={13} /> Isi {report.unaddressed.length} link
            </button>
          </div>
          <p className="mt-1 text-[10.5px]" style={{ color: 'var(--muted)' }}>
            Hanya link yang <strong>kedua ujungnya bermode routed</strong> dan masih kosong yang diisi.
            Blok yang sudah terpakai dilewati.
          </p>
        </section>

        {/* Link yang menunggu alamat */}
        {report.unaddressed.length > 0 ? (
          <section>
            <span className="label">Menunggu alamat ({report.unaddressed.length})</span>
            <ul className="thin-scroll max-h-32 space-y-1 overflow-y-auto">
              {report.unaddressed.map((u) => (
                <li
                  key={u.edgeId}
                  className="rounded-md border px-2 py-1 font-mono text-[10.5px]"
                  style={{ borderColor: 'var(--border)', background: 'var(--panel-2)' }}
                >
                  {u.aHost} {u.aIface} ↔ {u.bHost} {u.bIface}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* Daftar subnet */}
        <section>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="label mb-0">Subnet terpakai ({report.subnets.length})</span>
            {report.subnets.length > 0 ? (
              <button type="button" className="btn px-1.5 py-0.5 text-[11px]" onClick={exportPlan}>
                <Download size={11} /> CSV
              </button>
            ) : null}
          </div>

          {report.subnets.length === 0 ? (
            <p
              className="rounded-md border px-2 py-3 text-center text-[11.5px]"
              style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
            >
              Belum ada interface yang diberi alamat IP.
            </p>
          ) : (
            <ul className="thin-scroll max-h-[38vh] space-y-1.5 overflow-y-auto">
              {report.subnets.map((s) => (
                <li
                  key={formatCidr(s.network)}
                  className="rounded-md border p-2"
                  style={{ borderColor: 'var(--border)', background: 'var(--panel-2)' }}
                >
                  <div className="font-mono text-[11.5px] font-semibold">{subnetLabel(s)}</div>
                  <ul className="mt-1 space-y-0.5">
                    {s.members.map((m) => (
                      <li key={`${m.deviceId}-${m.ifaceId}`}>
                        <button
                          type="button"
                          className="text-left font-mono text-[10.5px] hover:underline"
                          style={{ color: 'var(--muted)' }}
                          onClick={() => focus(m.deviceId)}
                          title="Lompat ke perangkat ini di kanvas"
                        >
                          {formatCidr(m.cidr)} — {m.hostname} {m.ifaceName}
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="text-[10.5px]" style={{ color: 'var(--muted)' }}>
          Masalah pengalamatan — alamat ganda, dua ujung beda subnet, blok tumpang tindih — muncul di
          panel <strong>Pemeriksaan</strong> di sisi kanan bersama temuan lainnya.
        </p>
      </div>
    </Dialog>
  )
}
