import { z } from 'zod'
import { describeCatalog, describeTopology } from '@/lib/aiContext'
import type { Topology } from '@/types/topology'
import { SPEEDS } from '@/types/topology'

export type TaskId = 'config' | 'audit' | 'docs' | 'tidy' | 'build'

export interface TaskDef {
  id: TaskId
  label: string
  blurb: string
  /** 'text' ditampilkan apa adanya; 'json' diterapkan ke kanvas setelah divalidasi. */
  output: 'text' | 'json'
  /** Butuh topologi yang sudah ada sebagai bahan? */
  needsTopology: boolean
  placeholder: string
  system: string
  buildUser: (topo: Topology, instruction: string) => string
}

const COMMON_RULES = `Kamu asisten teknis untuk insinyur jaringan ISP di Indonesia.
Jawab dalam bahasa Indonesia, padat, tanpa basa-basi pembuka.
Jangan mengarang data yang tidak ada di topologi. Kalau informasinya kurang,
sebutkan apa yang kurang, jangan ditebak diam-diam.`

/* ── Skema jawaban yang akan diterapkan ke kanvas ─────────────────────────── */

export const tidyPlanSchema = z.object({
  direction: z.enum(['TB', 'LR']).default('TB'),
  groups: z
    .array(
      z.object({
        label: z.string(),
        devices: z.array(z.string()).min(1),
      }),
    )
    .default([]),
  alasan: z.string().default(''),
})
export type TidyPlan = z.infer<typeof tidyPlanSchema>

export const buildPlanSchema = z.object({
  name: z.string().default('Topologi Baru'),
  site: z.string().default(''),
  devices: z
    .array(
      z.object({
        hostname: z.string(),
        modelId: z.string(),
        site: z.string().default(''),
        mgmtIp: z.string().default(''),
      }),
    )
    .min(1),
  links: z
    .array(
      z.object({
        aHost: z.string(),
        aPort: z.string(),
        bHost: z.string(),
        bPort: z.string(),
        speed: z.enum(SPEEDS).default('10G'),
      }),
    )
    .default([]),
  catatan: z.string().default(''),
})
export type BuildPlan = z.infer<typeof buildPlanSchema>

/* ── Definisi tugas ───────────────────────────────────────────────────────── */

export const AI_TASKS: TaskDef[] = [
  {
    id: 'config',
    label: 'Konfigurasi perangkat',
    blurb: 'Hasilkan konfigurasi siap tempel dari topologi ini',
    output: 'text',
    needsTopology: true,
    placeholder: 'mis. "hanya untuk SSW-JKT-01 dan CCR2004-DIST-01" atau kosongkan untuk semua',
    system: `${COMMON_RULES}

Tugasmu membuat konfigurasi perangkat dari dokumentasi topologi.
Aturan sintaks per vendor:
- Juniper (Junos): gaya "set ..." lengkap dari hierarki teratas.
- Huawei (VRP): gaya baris perintah VRP, termasuk "interface Eth-Trunk1",
  "port link-type trunk", "port trunk allow-pass vlan ...".
- MikroTik (RouterOS): gaya "/interface bridge ...", "/interface bonding add ...".

Keluarkan satu blok per perangkat, diawali judul "## <hostname> (<vendor> <model>)".
Sertakan hanya yang benar-benar tertulis di topologi: interface, VLAN, Eth-Trunk/
bonding, alamat IP, dan deskripsi port. Jangan menambahkan routing protocol,
password, atau SNMP kalau tidak diminta.`,
    buildUser: (topo, instruction) =>
      `${describeTopology(topo)}\n\n---\nPermintaan: ${instruction || 'Buat konfigurasi untuk semua perangkat.'}`,
  },
  {
    id: 'audit',
    label: 'Audit & saran',
    blurb: 'Cari risiko dan kelemahan yang tidak tertangkap aturan baku',
    output: 'text',
    needsTopology: true,
    placeholder: 'mis. "fokus ke ketersediaan" atau "cek kapasitas uplink"',
    system: `${COMMON_RULES}

Tugasmu menelaah topologi dan menunjukkan masalah yang tidak bisa ditangkap
pemeriksaan otomatis berbasis aturan. Perhatikan terutama:
- Titik tunggal kegagalan: perangkat atau link yang kalau mati memutus banyak sisi.
- Jalur cadangan yang sebenarnya tidak terpisah (backup lewat perangkat yang sama).
- Ketidakseimbangan kapasitas: agregat akses lebih besar dari uplink di atasnya.
- Penamaan, VLAN, atau alamat yang tidak konsisten polanya.
- Peran perangkat yang tidak lazim untuk posisinya.

Susun jawaban sebagai daftar temuan. Tiap temuan: satu baris judul diawali
tingkat keparahan [TINGGI]/[SEDANG]/[RENDAH], lalu penjelasan singkat dan
saran perbaikan konkret. Urutkan dari yang paling parah. Kalau memang tidak
ada temuan pada suatu aspek, katakan begitu — jangan mengada-ada.`,
    buildUser: (topo, instruction) =>
      `${describeTopology(topo)}\n\n---\nPermintaan tambahan: ${instruction || '(tidak ada, telaah menyeluruh)'}`,
  },
  {
    id: 'docs',
    label: 'Dokumentasi jaringan',
    blurb: 'Tulis dokumen naratif dari topologi ini',
    output: 'text',
    needsTopology: true,
    placeholder: 'mis. "untuk serah terima ke tim NOC" atau "ringkas saja, 1 halaman"',
    system: `${COMMON_RULES}

Tugasmu menulis dokumentasi jaringan dalam format Markdown, siap dibaca orang
yang belum pernah melihat jaringan ini. Susunannya:
1. Ringkasan arsitektur — bagaimana trafik mengalir dari pelanggan ke upstream.
2. Daftar perangkat beserta peran dan lokasinya (tabel).
3. Rincian sambungan antar perangkat dan kapasitasnya (tabel).
4. Rancangan VLAN dan pengalamatan yang terbaca dari topologi.
5. Catatan operasional: jalur cadangan, hal yang perlu diperhatikan.

Pakai tabel Markdown untuk daftar. Jangan menyalin mentah daftar yang saya
berikan — rangkum dan jelaskan maknanya.`,
    buildUser: (topo, instruction) =>
      `${describeTopology(topo)}\n\n---\nPermintaan tambahan: ${instruction || '(tidak ada)'}`,
  },
  {
    id: 'tidy',
    label: 'Rapikan gambar',
    blurb: 'AI menentukan pengelompokan & arah, algoritma yang menggambar',
    output: 'json',
    needsTopology: true,
    placeholder: 'mis. "kelompokkan per POP" atau "pisahkan node Jakarta dan Bandung"',
    system: `${COMMON_RULES}

Tugasmu menyusun RENCANA pengelompokan diagram, bukan menentukan koordinat.
Penempatan piksel dikerjakan algoritma; kamu yang memutuskan perangkat mana
masuk kelompok mana dan arah susunannya.

Balas HANYA dengan JSON, tanpa penjelasan di luar JSON, berbentuk:
{
  "direction": "TB" atau "LR",
  "groups": [ { "label": "POP JKT-1", "devices": ["HOSTNAME-1", "HOSTNAME-2"] } ],
  "alasan": "satu-dua kalimat kenapa dikelompokkan begitu"
}

Aturan:
- Isi "devices" HARUS hostname persis seperti yang tertulis di topologi.
- Satu perangkat hanya boleh masuk satu kelompok.
- Perangkat yang tidak cocok masuk kelompok mana pun, tinggalkan saja.
- Kelompokkan berdasarkan site/POP kalau ada; kalau tidak, berdasarkan peran.
- Pakai "TB" untuk jaringan berjenjang (upstream di atas), "LR" kalau
  rantainya panjang dan sedikit percabangan.`,
    buildUser: (topo, instruction) =>
      `${describeTopology(topo)}\n\n---\nPermintaan: ${instruction || 'Kelompokkan sewajarnya.'}`,
  },
  {
    id: 'build',
    label: 'Buat dari deskripsi',
    blurb: 'Tulis rancangan jaringan dengan kalimat, perangkat & link dibuatkan',
    output: 'json',
    needsTopology: false,
    placeholder:
      'mis. "1 MX204 core, 2 SSW Huawei S6730, 4 switch akses S5731, core ke SSW 100G, SSW ke akses 10G"',
    system: `${COMMON_RULES}

Tugasmu menyusun topologi baru dari deskripsi pengguna.

Balas HANYA dengan JSON, tanpa penjelasan di luar JSON, berbentuk:
{
  "name": "nama topologi",
  "site": "site utama, boleh kosong",
  "devices": [ { "hostname": "MX204-CORE-01", "modelId": "juniper-mx204", "site": "POP-JKT-1", "mgmtIp": "10.10.0.1" } ],
  "links": [ { "aHost": "MX204-CORE-01", "aPort": "et-0/0/0", "bHost": "SSW-JKT-01", "bPort": "100GE1/0/1", "speed": "100G" } ],
  "catatan": "hal yang kamu asumsikan sendiri"
}

Aturan:
- "modelId" HARUS salah satu id dari daftar katalog di bawah, tulis persis.
- "aPort"/"bPort" HARUS disalin dari rentang port model itu di daftar katalog
  di bawah. JANGAN mengarang nama interface. Contoh: kalau katalog menulis
  "100GE1/0/1..100GE1/0/6", maka nama yang sah hanya 100GE1/0/1 sampai
  100GE1/0/6 — bukan 100GE0/0/25 atau bentuk lain.
- Satu port hanya boleh dipakai satu link.
- Hostname mengikuti pola yang jelas, mis. SSW-JKT-01, SW-ACC-03.
- Kecepatan link ikut port yang paling lambat di antara kedua sisi.
- Tuliskan di "catatan" setiap hal yang kamu putuskan sendiri karena tidak
  disebut pengguna.

KATALOG MODEL YANG BOLEH DIPAKAI:
${describeCatalog()}`,
    buildUser: (_topo, instruction) => instruction,
  },
]

export const getTask = (id: TaskId): TaskDef => AI_TASKS.find((t) => t.id === id) as TaskDef
