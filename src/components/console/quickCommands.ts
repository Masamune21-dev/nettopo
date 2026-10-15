import type { DialectId } from '@/lib/cli/types'

/**
 * Contoh perintah yang bisa diklik di atas konsol — titik awal bagi yang
 * belum hafal sintaks vendornya. Isinya sengaja perintah baca saja, kecuali
 * ping yang disisipkan ke baris masukan supaya alamat tujuannya diisi sendiri.
 */

export interface QuickCommand {
  label: string
  cmd: string
  /** Penjelasan singkat, tampil saat tombol disorot. */
  hint: string
  /** Disisipkan ke baris masukan, tidak langsung dijalankan. */
  insert?: boolean
}

const PING_HINT = 'Isi alamat tujuan, lalu tekan Enter'

export const QUICK_COMMANDS: Record<DialectId, QuickCommand[]> = {
  vrp: [
    { label: 'Status port', cmd: 'display interface brief', hint: 'Port mana yang up dan down' },
    { label: 'Alamat IP', cmd: 'display ip interface brief', hint: 'Interface L3 beserta alamatnya' },
    { label: 'VLAN', cmd: 'display port vlan', hint: 'Link-type dan VLAN tiap port' },
    { label: 'Tetangga', cmd: 'display lldp neighbor brief', hint: 'Perangkat yang tersambung lewat kabel' },
    { label: 'Routing', cmd: 'display ip routing-table', hint: 'Tabel routing' },
    { label: 'Konfigurasi', cmd: 'display current-configuration', hint: 'Seluruh konfigurasi yang berjalan' },
    { label: 'Ping…', cmd: 'ping ', hint: PING_HINT, insert: true },
  ],
  ios: [
    { label: 'Alamat IP', cmd: 'show ip interface brief', hint: 'Semua interface, alamat, dan statusnya' },
    { label: 'Status port', cmd: 'show interfaces status', hint: 'Port, VLAN, dan status kabel' },
    { label: 'VLAN', cmd: 'show vlan brief', hint: 'VLAN dan port access-nya' },
    { label: 'Tetangga', cmd: 'show cdp neighbors', hint: 'Perangkat yang tersambung lewat kabel' },
    { label: 'Routing', cmd: 'show ip route', hint: 'Tabel routing' },
    { label: 'Konfigurasi', cmd: 'show running-config', hint: 'Seluruh konfigurasi yang berjalan' },
    { label: 'Ping…', cmd: 'ping ', hint: PING_HINT, insert: true },
  ],
  junos: [
    { label: 'Status port', cmd: 'show interfaces terse', hint: 'Interface, status, dan alamatnya' },
    { label: 'Tetangga', cmd: 'show lldp neighbors', hint: 'Perangkat yang tersambung lewat kabel' },
    { label: 'Routing', cmd: 'show route', hint: 'Tabel routing' },
    { label: 'VLAN', cmd: 'show vlans', hint: 'VLAN dan interface anggotanya' },
    { label: 'Konfigurasi', cmd: 'show configuration | display set', hint: 'Konfigurasi dalam bentuk perintah set' },
    { label: 'Ping…', cmd: 'ping ', hint: PING_HINT, insert: true },
  ],
  routeros: [
    { label: 'Interface', cmd: '/interface print', hint: 'Daftar interface dan statusnya' },
    { label: 'Alamat IP', cmd: '/ip address print', hint: 'Alamat IP tiap interface' },
    { label: 'VLAN', cmd: '/interface bridge vlan print', hint: 'Tabel VLAN bridge (tagged/untagged)' },
    { label: 'Tetangga', cmd: '/ip neighbor print', hint: 'Perangkat yang tersambung lewat kabel' },
    { label: 'Routing', cmd: '/ip route print', hint: 'Tabel routing' },
    { label: 'Konfigurasi', cmd: '/export', hint: 'Seluruh konfigurasi sebagai skrip' },
    { label: 'Ping…', cmd: '/ping ', hint: PING_HINT, insert: true },
  ],
  linux: [
    { label: 'Alamat IP', cmd: 'ip addr', hint: 'NIC dan alamatnya' },
    { label: 'Routing', cmd: 'ip route', hint: 'Tabel routing dan gateway' },
    { label: 'Daftar perintah', cmd: 'help', hint: 'Perintah yang tersedia di simulasi' },
    { label: 'Ping…', cmd: 'ping -c 4 ', hint: PING_HINT, insert: true },
  ],
}

/**
 * Sesuaikan perintah dengan mode saat ini, seperti yang dilakukan orang
 * yang paham CLI-nya: `do` di mode konfigurasi IOS, `run` di mode
 * konfigurasi Junos, dan `enable` dulu sebelum `show running-config`.
 */
export function adaptQuick(dialect: DialectId, mode: string, cmd: string): string[] {
  if (dialect === 'ios') {
    if (mode === 'config' || mode === 'iface' || mode === 'vlan') return [`do ${cmd}`]
    if (mode === 'user' && cmd.startsWith('show running')) return ['enable', cmd]
  }
  if (dialect === 'junos' && mode === 'conf') return [`run ${cmd}`]
  return [cmd]
}

export const DIALECT_SHORT: Record<DialectId, string> = {
  vrp: 'VRP',
  ios: 'IOS',
  junos: 'Junos',
  routeros: 'RouterOS',
  linux: 'Linux',
}
