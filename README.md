# NetTopo — Editor Topologi Jaringan

Aplikasi web untuk menggambar topologi jaringan sampai level **port-ke-port**,
dengan katalog perangkat yang sesuai jaringan ISP di Indonesia: **Juniper MX,
switch & SSW Huawei, MikroTik CRS dan CCR**.

Mendukung **link aggregation / bonding** — Eth-Trunk (Huawei), ae (Juniper),
bond (MikroTik) — lengkap dengan daftar port anggotanya, serta **VLAN dan
link-type per interface** (access / trunk / hybrid / routed) seperti di
perangkat aslinya.

Semua data disimpan di browser Anda sendiri (tidak ada server, tidak ada login),
dan bisa diekspor ke JSON, PNG, SVG, atau CSV.

---

## Menjalankan

Node.js terpasang di `~/.local/node` (tanpa perlu admin). Supaya `npm` bisa
dipakai dari terminal mana pun, tambahkan satu baris ini ke `~/.zshrc`:

```bash
echo 'export PATH="$HOME/.local/node/bin:$PATH"' >> ~/.zshrc
```

Lalu buka terminal baru dan jalankan:

```bash
cd ~/Projects/nettopo && npm run dev
```

Buka <http://localhost:5173>.

| Perintah | Kegunaan |
|---|---|
| `npm run dev` | Server pengembangan dengan hot reload |
| `npm run build` | Build produksi ke `dist/` |
| `npm run preview` | Melihat hasil build produksi |
| `npm test` | Menjalankan unit test |
| `npm run test:watch` | Unit test mode watch |

---

## Cara pakai

1. **Seret perangkat** dari panel kiri ke kanvas (atau klik untuk menaruh di tengah).
2. **Tarik kabel** dari kotak port kecil di sisi node ke port perangkat lain.
   Port yang sudah terpakai tidak bisa dipakai dua kali, dan bila kecepatan kedua
   port berbeda, link otomatis memakai yang lebih rendah.
3. **Klik perangkat atau kabel** untuk mengubah hostname, IP manajemen, nama port,
   VLAN, kecepatan, dan sebagainya di panel kanan.
4. Perangkat berport banyak (mis. CRS354 dengan 54 port) tampil ringkas — klik
   tanda **▸** di pojok node untuk menampilkan seluruh portnya.
5. **Rapikan** menyusun ulang topologi secara berjenjang: internet → core →
   SSW/agregasi → distribusi → akses.
6. **Simpan** menyimpan ke browser; ada juga autosave setiap 1,5 detik setelah
   perubahan terakhir.
7. **Ekspor** ke PNG/SVG untuk laporan, JSON untuk cadangan, atau CSV untuk
   rekap. Ekspor CSV menghasilkan tiga berkas: `-perangkat.csv`, `-link.csv`,
   dan `-interface.csv` — yang terakhir berisi link-type, PVID, VLAN
   tagged/untagged, dan IP setiap interface.

### VLAN & mode interface

> **Catatan istilah:** "Eth-Trunk" (bonding) dan "link-type trunk" (VLAN
> bertag) sama-sama memakai kata *trunk* tetapi berbeda hal. Di aplikasi ini
> bagian **Trunk / bonding** mengurus agregasi port, sedangkan **link-type**
> mengurus VLAN.

Setiap interface — port fisik maupun Eth-Trunk — punya baris pengaturan
sendiri di panel kanan:

| Link-type | Field yang muncul | Setara di perangkat |
|---|---|---|
| **Access** | VLAN | `port link-type access` + `port default vlan 100` |
| **Trunk** | PVID + daftar VLAN tagged | `port link-type trunk` + `port trunk allow-pass vlan …` |
| **Hybrid** | PVID + tagged + untagged | `port link-type hybrid` |
| **Routed / L3** | Alamat IP | interface L3 ber-IP (MX, CCR, L3 switch) |

- Daftar VLAN ditulis gaya CLI: `100,200,300-310`. Kotaknya berubah merah
  kalau formatnya salah, dan alasannya muncul saat disorot.
- Di kanvas tiap interface diberi badge kecil: **A100** (access VLAN 100),
  **T** (trunk), **H** (hybrid), **L3**. Detail lengkapnya muncul di tooltip.
- Label pada kabel otomatis mengambil VLAN atau IP dari konfigurasi
  interface-nya — jadi tidak perlu mengetik dua kali.
- **Isi massal:** centang banyak port sekaligus, klik **VLAN**, isi sekali,
  lalu **Terapkan** — praktis untuk switch 48 port.
- Pemeriksaan otomatis menandai: daftar VLAN yang tidak sah, port access yang
  VLAN-nya kosong, PVID di luar daftar tagged, link-type berbeda di dua ujung
  link, dan VLAN yang hanya ada di satu sisi.

### Bonding / link aggregation

1. Pilih perangkatnya, lalu di panel kanan centang **2 port atau lebih** yang
   mau digabung (port yang sudah punya link sendiri tidak bisa dicentang).
2. Klik **Jadikan trunk**. Namanya otomatis mengikuti OS perangkat:

   | Vendor | Nama otomatis |
   |---|---|
   | Huawei (VRP) | `Eth-Trunk1`, `Eth-Trunk2`, … |
   | Juniper (Junos) | `ae0`, `ae1`, … |
   | MikroTik (RouterOS) | `bond1`, `bond2`, … |
   | Lainnya | `lag1`, `lag2`, … |

3. Di kanvas, trunk muncul sebagai **satu interface logis** (kotak lebar
   bergaris ganda) dengan keterangan `2× 10G`; port anggotanya disembunyikan
   supaya diagram tetap bersih. Tarik kabel dari trunk ke trunk di perangkat
   lawan seperti port biasa.
4. Mode bisa diubah antara **LACP (dinamis)** dan **manual/static**, anggota
   bisa ditambah atau dikeluarkan kapan saja, dan kapasitas total dihitung
   otomatis (`2× 10G = 20G`).
5. Pemeriksaan otomatis memperingatkan bila trunk cuma punya 1 anggota,
   anggotanya beda kecepatan, atau jumlah anggota di dua ujung link tidak sama.

### Pintasan keyboard

| Tombol | Aksi |
|---|---|
| `⌘/Ctrl + S` | Simpan |
| `⌘/Ctrl + Z` | Undo |
| `Shift + ⌘/Ctrl + Z` | Redo |
| `⌘/Ctrl + D` | Duplikat yang terpilih |
| `Delete` / `Backspace` | Hapus yang terpilih |
| `Esc` | Batalkan seleksi |
| `?` | Bantuan |

Scroll untuk menggeser kanvas, `⌥/Alt + scroll` untuk zoom, drag kiri untuk
seleksi kotak, drag tengah/kanan untuk menggeser.

---

## Menambah model perangkat

Semua spesifikasi hardware ada di satu file: [`src/data/deviceCatalog.ts`](src/data/deviceCatalog.ts).
Menambah model cukup menambahkan satu entri:

```ts
{
  id: 'mikrotik-ccr2004-16g-2sp',        // unik, dipakai di file JSON
  vendor: 'mikrotik',
  series: 'CCR2004',
  model: 'CCR2004-16G-2S+',
  role: 'router',                         // menentukan ikon, warna, dan lapisan auto-layout
  os: 'routeros',
  note: '16× GE + 2× SFP+ 10G',           // tampil di tooltip palette
  ports: [
    { prefix: 'ether',       count: 16, startIndex: 1, speed: '1G',  media: 'rj45', group: 'Ethernet' },
    { prefix: 'sfp-sfpplus', count: 2,  startIndex: 1, speed: '10G', media: 'sfp+', group: 'SFP+ 10G' },
  ],
}
```

- `prefix` + nomor + `suffix` membentuk nama interface: `ether1`, `et-0/0/0`,
  `10GE1/0/1`, `qsfpplus1-1`, dan seterusnya.
- `startIndex` **0** untuk Juniper, **1** untuk Huawei dan MikroTik.
- Nama dan jumlah port juga bisa diubah langsung dari UI (tabel port di panel
  kanan) tanpa menyentuh kode — perubahan itu tersimpan per perangkat.

Spesifikasi port bawaan mengikuti konfigurasi umum tiap model. Untuk chassis
modular (MX240/480/960/10003) yang dipakai adalah konfigurasi contoh, karena
port sesungguhnya bergantung pada MPC/MIC yang terpasang — silakan sesuaikan.

---

## Format file JSON

Ekspor JSON menghasilkan dokumen yang bisa diimpor kembali, disimpan di git,
atau dibaca oleh skrip lain. Strukturnya (lihat [`src/types/topology.ts`](src/types/topology.ts)):

```jsonc
{
  "schemaVersion": 3,
  "project": { "id": "...", "name": "Backbone Jakarta", "site": "POP-JKT-1", "updatedAt": "..." },
  "devices": [
    {
      "id": "dev_1", "modelId": "juniper-mx204", "hostname": "MX204-CORE-01",
      "role": "core-router", "mgmtIp": "10.10.0.1", "loopback": "10.255.0.1",
      "site": "POP-JKT-1", "notes": "", "position": { "x": 380, "y": 20 },
      "ports": [
        // linkType: none | access | trunk | hybrid | routed
        { "id": "p_1", "name": "et-0/0/0", "speed": "100G", "media": "qsfp28",
          "description": "to SSW-01", "side": "left",
          "linkType": "routed", "pvid": null, "allowedVlans": "",
          "untaggedVlans": "", "ipAddress": "10.0.0.1/30" },
        { "id": "p_2", "name": "et-0/0/1", "speed": "100G", "media": "qsfp28",
          "description": "", "side": "right",
          "linkType": "trunk", "pvid": 1, "allowedVlans": "1,100,200,300-305",
          "untaggedVlans": "", "ipAddress": "" }
      ],
      // Eth-Trunk juga punya link-type & VLAN sendiri, sama seperti port fisik
      "trunks": [
        { "id": "trk_1", "name": "ae0", "mode": "lacp",
          "memberIds": ["p_3", "p_4"], "description": "", "side": "left",
          "linkType": "trunk", "pvid": 1, "allowedVlans": "1,100,200",
          "untaggedVlans": "", "ipAddress": "" }
      ]
    }
  ],
  "links": [
    // Ujung link menunjuk port fisik ATAU trunk — salah satu terisi.
    { "id": "lnk_1",
      "a": { "deviceId": "dev_1", "portId": "p_1", "trunkId": null },
      "b": { "deviceId": "dev_2", "portId": "p_9", "trunkId": null },
      "speed": "100G", "media": "fiber", "kind": "single",
      "label": "Core ↔ SSW", "vlans": "100,200", "color": null },
    { "id": "lnk_2",
      "a": { "deviceId": "dev_1", "portId": "", "trunkId": "trk_1" },
      "b": { "deviceId": "dev_3", "portId": "", "trunkId": "trk_9" },
      "speed": "10G", "media": "fiber", "kind": "lacp",
      "label": "", "vlans": "", "color": null }
  ],
  "groups": [ /* kotak area / POP */ ],
  "notes":  [ /* catatan tempel */ ]
}
```

File yang diimpor divalidasi dengan zod; kalau ada yang tidak sesuai, aplikasi
menyebutkan field mana yang bermasalah dan tidak menimpa pekerjaan Anda.

File lama tetap bisa dibuka: **versi 1** (sebelum ada trunk) dan **versi 2**
(sebelum ada VLAN) — field baru terisi nilai bawaan, lalu file tersimpan ulang
sebagai versi 3.

---

## Struktur kode

```
src/
├─ types/topology.ts        # tipe + skema zod + palet warna
├─ data/deviceCatalog.ts    # katalog vendor/model/port  ← ubah di sini untuk menambah perangkat
├─ data/sampleTopology.ts   # topologi contoh saat pertama dibuka
├─ store/useTopologyStore.ts# state kanvas, undo/redo, aturan penyambungan port
├─ store/useUiStore.ts      # tema, panel, preferensi tampilan
├─ components/              # Toolbar, DevicePalette, Canvas, node, edge, Inspector
└─ lib/                     # ports, layout (dagre), serialize, persistence, export, validate
```

---

## Yang belum ada (rencana berikutnya)

- Monitoring live: warna up/down per perangkat dan link lewat ping/SNMP.
- Auto-discovery LLDP/SNMP untuk menggambar topologi otomatis.
- Backend multi-user dengan login dan riwayat perubahan.

Struktur data sekarang sudah disiapkan untuk itu: tinggal menambah backend yang
mengirim status per `deviceId`/`linkId`, tanpa mengubah format file.
