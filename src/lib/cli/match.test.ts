import { describe, expect, it } from 'vitest'
import { type CommandSpec, match, nextOptions } from './match'
import { maskToPrefix, resolveIfaceName, tokenize } from './text'

const spec = (syntax: string): CommandSpec<string> => ({ syntax, run: () => syntax })

const SPECS = [
  spec('display ip interface brief'),
  spec('display ip routing-table'),
  spec('display interface brief'),
  spec('display interface <if:iface>'),
  spec('display version'),
  spec('interface <if:iface>'),
  spec('port default vlan <vlan:int:1-4094>'),
  spec('description <text:text>'),
]

const run = (line: string) => match(SPECS, tokenize(line))

describe('match', () => {
  it('menerima singkatan kata kunci selama tidak rancu', () => {
    const m = run('dis ip int br')
    expect(m.ok && m.spec.syntax).toBe('display ip interface brief')
  })

  it('melaporkan singkatan yang rancu beserta pilihannya', () => {
    const m = run('dis i')
    expect(m).toMatchObject({ ok: false, error: 'ambiguous', at: 1, options: ['interface', 'ip'] })
  })

  it('membedakan perintah yang belum lengkap dari yang salah', () => {
    expect(run('display')).toMatchObject({ ok: false, error: 'incomplete' })
    expect(run('display ipp brief')).toMatchObject({ ok: false, error: 'unrecognized', at: 1 })
  })

  it('kata kunci menang atas param, param dipakai bila tidak ada kata kunci', () => {
    const brief = run('display interface brief')
    expect(brief.ok && brief.spec.syntax).toBe('display interface brief')
    const port = run('display interface GE0/0/1')
    expect(port.ok && port.args.if).toBe('GE0/0/1')
  })

  it('nama interface boleh dipisah spasi dari nomornya', () => {
    const m = run('interface GigabitEthernet 0/0/1')
    expect(m.ok && m.args.if).toBe('GigabitEthernet0/0/1')
  })

  it('menolak angka di luar rentang dan menyimpan sisa baris untuk param teks', () => {
    expect(run('port default vlan 5000')).toMatchObject({ ok: false })
    const d = run('description ke SSW "lantai 2"')
    expect(d.ok && d.args.text).toBe('ke SSW lantai 2')
  })

  it('nextOptions memberi kata berikutnya dan <cr> bila perintah sudah sah', () => {
    const o = nextOptions(SPECS, tokenize('display ip'), null, {})
    expect(o?.items.map((i) => i.word).sort()).toEqual(['interface', 'routing-table'])
    expect(nextOptions(SPECS, tokenize('display version'), null, {})?.cr).toBe(true)
    expect(nextOptions(SPECS, tokenize('display'), 'v', {})?.items.map((i) => i.word)).toEqual(['version'])
  })
})

describe('resolveIfaceName', () => {
  const huawei = ['GE0/0/1', 'GE0/0/2', 'XGE0/0/1', 'Eth-Trunk1']
  const aliases = { gigabitethernet: 'ge', xgigabitethernet: 'xge', 'eth-trunk': 'eth-trunk' }

  it('memetakan nama panjang Huawei ke nama pendek di data', () => {
    expect(resolveIfaceName('GigabitEthernet0/0/1', huawei, aliases)).toBe('GE0/0/1')
    expect(resolveIfaceName('XGigabitEthernet0/0/1', huawei, aliases)).toBe('XGE0/0/1')
    expect(resolveIfaceName('eth-trunk 1', huawei, aliases)).toBe('Eth-Trunk1')
  })

  it('menerima singkatan gaya Cisco', () => {
    const cisco = ['GigabitEthernet1/0/1', 'TenGigabitEthernet1/1/1', 'Port-channel1']
    expect(resolveIfaceName('gi1/0/1', cisco)).toBe('GigabitEthernet1/0/1')
    expect(resolveIfaceName('te1/1/1', cisco)).toBe('TenGigabitEthernet1/1/1')
    expect(resolveIfaceName('po1', cisco)).toBe('Port-channel1')
    expect(resolveIfaceName('gi9/9/9', cisco)).toBeNull()
  })
})

describe('maskToPrefix', () => {
  it('menerima mask titik-desimal maupun panjang prefix', () => {
    expect(maskToPrefix('255.255.255.252')).toBe(30)
    expect(maskToPrefix('255.255.255.255')).toBe(32)
    expect(maskToPrefix('0.0.0.0')).toBe(0)
    expect(maskToPrefix('24')).toBe(24)
    expect(maskToPrefix('255.0.255.0')).toBeNull()
  })
})
