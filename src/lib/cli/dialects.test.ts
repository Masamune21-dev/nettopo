import { describe, expect, it } from 'vitest'
import { getModel } from '@/data/deviceCatalog'
import { sampleTopology } from '@/data/sampleTopology'
import type { World } from './engine'
import { dialectIdFor } from './index'
import { byHost, cable, device, port, session, setPort } from './testkit'

function sample(): World {
  const s = sampleTopology()
  return { nodes: s.nodes, edges: s.edges }
}

const portOf = (w: World, host: string, name: string) => port(w, byHost(w, host).id, name)

describe('dialectIdFor', () => {
  it('memilih dialek menurut OS, dan menolak perangkat pasif', () => {
    expect(dialectIdFor(getModel('huawei-s5731-s24t4x'), 'access-switch')).toBe('vrp')
    expect(dialectIdFor(getModel('juniper-mx204'), 'core-router')).toBe('junos')
    expect(dialectIdFor(getModel('mikrotik-ccr2116-12g-4sp'), 'router')).toBe('routeros')
    expect(dialectIdFor(getModel('cisco-c9300-48p'), 'access-switch')).toBe('ios')
    expect(dialectIdFor(getModel('zte-c320'), 'olt')).toBe('ios')
    expect(dialectIdFor(getModel('generic-server'), 'server')).toBe('linux')
    expect(dialectIdFor(getModel('generic-odp'), 'passive')).toBeNull()
  })
})

describe('Huawei VRP', () => {
  it('port L2 di switch harus `undo portswitch` dulu sebelum diberi IP', () => {
    const w = sample()
    const s = session(w, byHost(w, 'SW-ACC-JKT-01').id)
    s.run('system-view')
    s.run('interface GigabitEthernet0/0/10')
    s.run('port link-type access')
    expect(s.run('ip address 10.9.0.1 255.255.255.252')).toMatch(/Layer 2 port/)
    s.run('undo portswitch')
    s.run('ip address 10.9.0.1 30')
    expect(portOf(w, 'SW-ACC-JKT-01', 'GE0/0/10')).toMatchObject({ linkType: 'routed', ipAddress: '10.9.0.1/30' })
    expect(s.prompt()).toBe('[SW-ACC-JKT-01-GigabitEthernet0/0/10]')
  })

  it('VLAN trunk bersifat menambah, seperti perangkat asli', () => {
    const w = sample()
    const s = session(w, byHost(w, 'SW-ACC-JKT-01').id)
    s.run('sys')
    s.run('int g0/0/20')
    s.run('port link-type trunk')
    s.run('port trunk allow-pass vlan 100 200 300 to 302')
    s.run('undo port trunk allow-pass vlan 200')
    expect(portOf(w, 'SW-ACC-JKT-01', 'GE0/0/20')).toMatchObject({ linkType: 'trunk', allowedVlans: '1,100,300-302' })
  })

  it('Eth-Trunk: port yang masih berkabel sendiri ditolak dengan penjelasan', () => {
    const w = sample()
    const s = session(w, byHost(w, 'SW-ACC-JKT-01').id)
    s.run('sys')
    s.run('interface Eth-Trunk 7')
    s.run('quit')
    s.run('interface XGigabitEthernet0/0/1')
    expect(s.run('eth-trunk 7')).toMatch(/link in the topology[\s\S]*Pindahkan kabelnya/)
    s.run('interface GE0/0/21')
    s.run('eth-trunk 7')
    const d = s.data()
    const trunk = d.trunks.find((t) => t.name === 'Eth-Trunk7')
    expect(trunk?.memberIds).toEqual([portOf(w, 'SW-ACC-JKT-01', 'GE0/0/21').id])
  })

  it('VRP8 (NE8000) menampung perubahan sampai `commit`', () => {
    const w = sample()
    const s = session(w, byHost(w, 'NE8000-BNG-01').id)
    s.run('system-view')
    expect(s.prompt()).toBe('[~NE8000-BNG-01]')
    s.run('sysname BNG-BARU')
    expect(s.prompt()).toBe('[*NE8000-BNG-01]')
    expect(s.data().hostname).toBe('NE8000-BNG-01')
    s.run('commit')
    expect(s.data().hostname).toBe('BNG-BARU')
    expect(s.prompt()).toBe('[~BNG-BARU]')
  })

  it('singkatan rancu dan perintah salah memakai pesan khas Huawei', () => {
    const w = sample()
    const s = session(w, byHost(w, 'SSW-JKT-01').id)
    expect(s.run('dis i')).toMatch(/Ambiguous command found at '\^' position/)
    expect(s.run('dis ip intt br')).toMatch(/\n?Error: Unrecognized command found at '\^' position/)
    expect(s.run('dis ip int br')).toMatch(/100GE1\/0\/1\s+10\.255\.0\.6\/30\s+up\s+up/)
  })

  it('save menanyakan konfirmasi lalu menyimpan', () => {
    const w = sample()
    const s = session(w, byHost(w, 'SSW-JKT-01').id)
    s.run('save')
    expect(s.prompt()).toMatch(/\(y\/n\)/)
    expect(s.run('y')).toMatch(/saved successfully/)
  })
})

describe('Cisco IOS', () => {
  function lab() {
    const w: World = { nodes: [], edges: [] }
    const sw = device(w, 'cisco-c9300-48p', 'SW1')
    const rt = device(w, 'cisco-asr1001-x', 'RT1')
    cable(w, sw, 'TenGigabitEthernet1/1/1', rt, 'TenGigabitEthernet0/0/6')
    return { w, sw, rt }
  }

  it('alur enable → configure terminal → interface, lalu ping antar perangkat', () => {
    const { w, sw, rt } = lab()
    const a = session(w, sw)
    expect(a.run('conf t')).toMatch(/Invalid input/)
    a.run('enable')
    a.run('configure terminal')
    a.run('interface te1/1/1')
    expect(a.prompt()).toBe('SW1(config-if)#')
    expect(a.run('ip address 10.1.1.1 255.255.255.252')).toMatch(/may not be configured on L2 links/)
    a.run('no switchport')
    a.run('ip address 10.1.1.1 255.255.255.252')
    a.run('end')

    const b = session(w, rt)
    b.run('en')
    b.run('conf t')
    b.run('int te0/0/6')
    b.run('ip address 10.1.1.2 255.255.255.252')
    b.run('end')
    expect(b.run('ping 10.1.1.1')).toMatch(/!!!!!\nSuccess rate is 100 percent/)
    expect(b.run('show cdp neighbors')).toMatch(/SW1\s+Ten 0\/0\/6/)
  })

  it('channel-group membuat Port-channel dan memasukkan port', () => {
    const { w, sw } = lab()
    const a = session(w, sw)
    a.run('enable')
    a.run('conf t')
    a.run('int g1/0/1')
    expect(a.run('channel-group 1 mode active')).toMatch(/Creating a port-channel interface Port-channel 1/)
    a.run('int g1/0/2')
    a.run('channel-group 1 mode active')
    const po = a.data().trunks.find((t) => t.name === 'Port-channel1')
    expect(po).toMatchObject({ mode: 'lacp' })
    expect(po?.memberIds).toHaveLength(2)
    expect(a.run('do show etherchannel summary')).toMatch(/Po1\(SD\)\s+LACP\s+Gi1\/0\/1\(D\)\s+Gi1\/0\/2\(D\)/)
  })

  it('trunk native dan allowed VLAN', () => {
    const { w, sw } = lab()
    const a = session(w, sw)
    a.run('en')
    a.run('conf t')
    a.run('int gi1/0/5')
    a.run('switchport mode trunk')
    a.run('switchport trunk allowed vlan 10,20')
    a.run('switchport trunk allowed vlan add 30')
    a.run('switchport trunk native vlan 99')
    expect(port(w, sw, 'GigabitEthernet1/0/5')).toMatchObject({ linkType: 'trunk', pvid: 99, allowedVlans: '10,20,30' })
  })
})

describe('Juniper Junos', () => {
  it('perubahan baru berlaku setelah commit; rollback membuangnya', () => {
    const w = sample()
    const s = session(w, byHost(w, 'MX204-CORE-01').id)
    s.run('configure')
    s.run('set interfaces et-0/0/3 description "ke SSW-02"')
    expect(portOf(w, 'MX204-CORE-01', 'et-0/0/3').description).toBe('')
    expect(s.run('show | compare')).toMatch(/\[edit interfaces et-0\/0\/3\]\n\+\s+description "ke SSW-02";/)
    s.run('rollback 0')
    expect(s.run('show | compare')).not.toMatch(/description/)

    s.run('set interfaces et-0/0/3 description "ke SSW-02"')
    expect(s.run('commit')).toMatch(/commit complete/)
    expect(portOf(w, 'MX204-CORE-01', 'et-0/0/3').description).toBe('ke SSW-02')
  })

  it('edit menyetel hierarki, dan set di dalamnya relatif terhadap hierarki itu', () => {
    const w = sample()
    const s = session(w, byHost(w, 'MX204-CORE-01').id)
    s.run('configure')
    expect(s.run('edit interfaces xe-0/1/3')).toMatch(/\[edit interfaces xe-0\/1\/3\]/)
    s.run('set unit 0 family ethernet-switching interface-mode trunk')
    s.run('set unit 0 family ethernet-switching vlan members [ 100 200 ]')
    s.run('set native-vlan-id 100')
    s.run('top')
    s.run('commit and-quit')
    expect(portOf(w, 'MX204-CORE-01', 'xe-0/1/3')).toMatchObject({ linkType: 'trunk', pvid: 100, allowedVlans: '100,200' })
    expect(s.prompt()).toBe('admin@MX204-CORE-01> ')
  })

  it('menolak family inet dan ethernet-switching di unit yang sama', () => {
    const w = sample()
    const s = session(w, byHost(w, 'MX204-CORE-01').id)
    s.run('configure')
    expect(s.run('set interfaces et-0/0/2 unit 0 family ethernet-switching interface-mode trunk')).toMatch(/cannot be configured together/)
  })

  it('rute statis lewat routing-options dan loopback lewat lo0', () => {
    const w = sample()
    const s = session(w, byHost(w, 'MX204-CORE-01').id)
    s.run('configure')
    s.run('set routing-options static route 0.0.0.0/0 next-hop 103.20.0.1')
    s.run('set interfaces lo0 unit 0 family inet address 10.255.255.1/32')
    s.run('commit')
    expect(s.data()).toMatchObject({ loopback: '10.255.255.1', staticRoutes: [{ prefix: '0.0.0.0/0', nextHop: '103.20.0.1' }] })
    s.run('exit')
    expect(s.run('show route')).toMatch(/0\.0\.0\.0\/0\s+\*\[Static\/5\][\s\S]*to 103\.20\.0\.1 via et-0\/0\/0\.0/)
    expect(s.run('show configuration | display set | match lo0')).toBe('set interfaces lo0 unit 0 family inet address 10.255.255.1/32')
  })
})

describe('MikroTik RouterOS', () => {
  it('bridge port + bridge vlan dipetakan ke access/trunk/hybrid', () => {
    const w = sample()
    const s = session(w, byHost(w, 'CCR2116-DIST-JKT').id)
    s.run('/interface bridge port add bridge=bridge1 interface=ether2 pvid=100')
    expect(portOf(w, 'CCR2116-DIST-JKT', 'ether2')).toMatchObject({ linkType: 'access', pvid: 100 })
    s.run('/interface bridge port add bridge=bridge1 interface=ether3')
    s.run('/interface bridge vlan add bridge=bridge1 vlan-ids=500,600 tagged=ether3 untagged=ether2')
    expect(portOf(w, 'CCR2116-DIST-JKT', 'ether3')).toMatchObject({ linkType: 'trunk', pvid: 1, allowedVlans: '500,600' })
    expect(portOf(w, 'CCR2116-DIST-JKT', 'ether2')).toMatchObject({ linkType: 'hybrid', pvid: 100, untaggedVlans: '500,600' })
    expect(s.run('/interface bridge vlan print')).toMatch(/bridge1\s+500\s+ether3\s+ether2/)
  })

  it('menu bisa dimasuki lalu perintahnya dipakai tanpa garis miring', () => {
    const w = sample()
    const s = session(w, byHost(w, 'CCR2116-DIST-JKT').id)
    s.run('/ip address')
    expect(s.prompt()).toBe('[admin@CCR2116-DIST-JKT] /ip address> ')
    s.run('add address=10.50.0.1/24 interface=ether1')
    expect(s.run('print')).toMatch(/0\s+10\.50\.0\.1\/24\s+10\.50\.0\.0\s+ether1/)
    expect(s.run('ping 10.50.0.2')).toMatch(/bad command name ping[\s\S]*\/ping/)
    s.run('remove 0')
    expect(portOf(w, 'CCR2116-DIST-JKT', 'ether1')).toMatchObject({ linkType: 'none', ipAddress: '' })
  })

  it('bonding: tambah, lalu ekspor menampilkan konfigurasinya', () => {
    const w = sample()
    const s = session(w, byHost(w, 'CCR2116-DIST-JKT').id)
    s.run('/interface bonding add name=bond9 slaves=ether5,ether6 mode=802.3ad')
    expect(s.data().trunks.find((t) => t.name === 'bond9')).toMatchObject({ mode: 'lacp' })
    expect(s.run('/export')).toMatch(/add mode=802\.3ad name=bond9 slaves=ether5,ether6/)
    expect(s.run('/interface bonding add name=bond8 slaves=sfp-sfpplus3')).toMatch(/failure: sfp-sfpplus3 has its own link/)
  })
})

describe('Shell Linux', () => {
  it('ip addr add, gateway harus satu subnet, lalu ping', () => {
    const w: World = { nodes: [], edges: [] }
    const srv = device(w, 'generic-server', 'SRV1')
    const rt = device(w, 'generic-router', 'RT1')
    setPort(w, rt, 'port1', { linkType: 'routed', ipAddress: '10.0.0.1/24' })
    cable(w, srv, 'nic1', rt, 'port1')
    const s = session(w, srv)
    expect(s.run('ip route add default via 10.0.0.1')).toMatch(/Network is unreachable/)
    s.run('ip addr add 10.0.0.10/24 dev nic1')
    s.run('ip route add default via 10.0.0.1')
    expect(s.run('ip r')).toMatch(/default via 10\.0\.0\.1 dev nic1/)
    expect(s.run('ping -c 2 10.0.0.1')).toMatch(/2 packets transmitted, 2 received, 0% packet loss/)
    expect(s.run('foo')).toBe('bash: foo: command not found')
  })
})
