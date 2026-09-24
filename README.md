# NetTopo — Network Topology Editor

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A web app for drawing network topologies down to the **port-to-port** level,
with a device catalog built around the hardware Indonesian ISPs actually run:
**Juniper MX, Huawei switches and SSWs, MikroTik CRS and CCR**, and more.

It supports **link aggregation / bonding** — Eth-Trunk (Huawei), ae (Juniper),
bond (MikroTik) — with the full list of member ports, plus **VLANs and a
link-type per interface** (access / trunk / hybrid / routed), just like on the
real devices.

All data stays in your own browser (no server, no login) and can be exported
to JSON, PNG, SVG, or CSV.

> **Note:** the app's interface is in Indonesian. This README quotes button and
> menu names exactly as they appear on screen, with an English gloss the first
> time each one comes up.

---

![NetTopo full view](docs/img/01-tampilan-penuh.png)

---

## Getting started

**Requirements:** [Node.js](https://nodejs.org) **22.12+ or 24 LTS** (npm is
included). Check with `node -v`.

```bash
git clone https://github.com/Masamune21-dev/nettopo.git
cd nettopo
npm install
npm run dev
```

Open <http://localhost:5173>. That's it — there is no database to set up and no
separate server to run. Topologies are saved in your browser; see
[JSON file format](#json-file-format) for moving them between machines.

| Command | Purpose |
|---|---|
| `npm run dev` | Development server with hot reload |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview the production build |
| `npm test` | Run the unit tests |
| `npm run test:watch` | Unit tests in watch mode |
| `npm run lint` | Lint the code |

`npm run build` produces static files in `dist/`, so they can be served from any
web server (nginx, Apache, GitHub Pages) with no Node.js on the server. The
only feature that needs a server-side component is the
[AI assistant](#ai-assistant-optional), because its API key is deliberately
kept off the browser — the dev server handles that locally, and a serverless
function does it on [Vercel](#deploying-to-vercel).

---

## Sample topology

On first launch the app loads a sample two-POP ISP network — **23 devices, 30
links** — that you can edit right away or clear via **Buka → Topologi baru**
(*Open → New topology*):

- **Dual upstream**: IIX peering and international transit, each landing on a
  different core
- **POP JKT-1**: a pair of MX204s cross-connected to two Huawei SSWs, an NE8000
  BNG, a management firewall, and an NMS server
- **POP BDG-1**: its own MX204 and SSW, connected to Jakarta over separate
  primary and backup paths
- **Eth-Trunk**: 2×100G between the SSWs, and 2×10G from SSW to the MikroTik
  distribution layer
- **FTTH**: Huawei MA5800 and ZTE C320 OLTs, then ODC → ODP → customer ONT
- **VLANs**: 100 retail, 200 corporate, 300 CCTV, 400 management — consistent
  from the backbone down to customer ports
- **13 /30 subnets** covering every L3 link

![Device, port, and cable detail](docs/img/02-detail-perangkat.png)

Everything is readable straight off the canvas: **L3** badges and `/30`
addresses on routed links, a **T** badge on VLAN-tagged ports, Eth-Trunks with
their combined capacity (`2× 100G`), the VLANs each cable carries, and the FTTH
chain running from the OLT down through the ODC.

The sample doubles as a reference for a correct configuration: a test keeps it
passing **every check without a single warning** — matching speeds on both
ends, consistent VLANs, one subnet per L3 link, no port used twice, and no
dangling devices. If a new check ever makes it fail, that shows up immediately.

---

## Usage

1. **Drag a device** from the left panel onto the canvas (or click it to drop it
   in the center).
2. **Draw a cable** from the small port box on the side of a node to a port on
   another device. A port that is already in use can't be used twice, and if the
   two ports have different speeds the link takes the lower one.
3. **Click a device or cable** to edit its hostname, management IP, port names,
   VLANs, speed, and so on in the right panel.
4. Devices with many ports (e.g. a 54-port CRS354) are shown collapsed — click
   the **▸** in the node's corner to show every port.
5. **Rapikan** (*Tidy up*) re-lays out the topology in tiers (internet → core →
   SSW/aggregation → distribution → access), moves each port to the side of the
   node facing its peer, and resizes area boxes so they still wrap the same
   devices. The same menu also has **align left/right/top/bottom/center** and
   **distribute evenly** for the current selection.
6. **Simpan** (*Save*) stores the topology in the browser; there is also an
   autosave 1.5 seconds after the last change.
7. **Ekspor** (*Export*) to PNG/SVG for reports, JSON for backups, or CSV for
   inventories. The CSV export produces three files: `-perangkat.csv`
   (devices), `-link.csv` (links), and `-interface.csv` — the last one lists the
   link-type, PVID, tagged/untagged VLANs, and IP of every interface.

### Bending cables

Cables don't have to run straight from port to port:

1. **Click the cable** on the canvas. Small dots appear in the middle of each
   segment.
2. **Click a dot** to add a bend there.
3. **Drag** the handle that appears to move the bend; **double-click** it to
   remove it. One drag = one undo step.
4. In the right panel, **Gaya kabel** (*Cable style*) can be switched between
   *Lengkung* (*Curved*, the default), *Siku (orthogonal)* for rack-style
   diagrams, or *Lurus* (*Straight*). **Hapus belokan** (*Remove bends*) clears
   every bend on that cable.

### Making a cable perfectly straight

A cable often looks "almost straight but with a kink" because its two ports are
a few pixels apart: port rows inside a node are 12 px apart, while nodes snap to
the grid, so the offset is rarely exactly zero.

Redrawing the cable doesn't help — both ends are pinned to their ports. It's the
device that needs to move. Select the cable and press **Luruskan kabel**
(*Straighten cable*) in the right panel: one of the devices is shifted just
enough to line the two ports up, and the button changes to "Kabel sudah lurus"
(*Cable is straight*). The number of pixels is shown on the button; above
100 px it turns yellow as a warning that the layout will visibly change.
Everything can be undone with `Cmd/Ctrl + Z`.

The grid size itself can be changed from the **Grid** menu in the toolbar: 8,
16 (default), 24, or 32 px — which also sets the density of the background dots.

Bends are saved in the JSON file. Auto-layout discards them because device
positions change — the notification says how many were removed.

### IP addressing (IPAM)

![IP address overview](docs/img/05-alamat-ip.png)

The **IP** button in the toolbar opens an addressing overview for the whole
topology:

- **Subnet list** of everything in use, with address range, capacity, and which
  interfaces live in it. Click one to jump to its device on the canvas.
- **Beri alamat otomatis** (*Auto-assign addresses*) for L3 links whose two ends
  are both *routed* but still empty. Pick a parent block (e.g. `10.0.0.0/16`)
  and a per-link size — `/30`, `/31` (RFC 3021), or `/29` — and every pending
  link is filled in one go. Blocks already in use are skipped, so it is safe to
  run again at any time. Undo with `Cmd/Ctrl + Z`.
- **CSV export** of the addressing plan, for document appendices or importing
  into other systems.

Addressing problems appear in the **Pemeriksaan** (*Checks*) panel alongside
other findings:

| Check | Example |
|---|---|
| Invalid address | `10.0.0.999/30` |
| Network or broadcast address used by a host | `10.0.0.4/30` on a /30 |
| Same address on two interfaces | two devices using `10.0.0.1` |
| Link ends in different subnets | `10.0.0.1/30` ↔ `10.0.0.9/30` |
| Only one end addressed | the other side is still empty |
| Overlapping blocks | `10.0.0.0/24` and `10.0.0.128/25` |
| Over-full block | 3 interfaces inside one `/30` |

### VLANs & interface modes

<img src="docs/img/03-panel-perangkat.png" width="380" alt="Device properties panel">


> **A note on terms:** "Eth-Trunk" (bonding) and "link-type trunk" (tagged
> VLANs) both use the word *trunk* but mean different things. In this app the
> **Trunk / bonding** section handles port aggregation, while **link-type**
> handles VLANs.

Every interface — physical port or Eth-Trunk — has its own settings row in the
right panel:

| Link-type | Fields shown | Device equivalent |
|---|---|---|
| **Access** | VLAN | `port link-type access` + `port default vlan 100` |
| **Trunk** | PVID + tagged VLAN list | `port link-type trunk` + `port trunk allow-pass vlan …` |
| **Hybrid** | PVID + tagged + untagged | `port link-type hybrid` |
| **Routed / L3** | IP address | an L3 interface with an IP (MX, CCR, L3 switch) |

- VLAN lists use CLI syntax: `100,200,300-310`. The field turns red if the
  format is wrong, and the reason appears on hover.
- On the canvas each interface gets a small badge: **A100** (access VLAN 100),
  **T** (trunk), **H** (hybrid), **L3**. The full details are in the tooltip.
- Cable labels automatically pick up the VLANs or IP from the interface
  configuration — no need to type them twice.
- **Bulk edit:** tick several ports, click **VLAN**, fill it in once, then
  **Terapkan** (*Apply*) — handy for 48-port switches.
- Automatic checks flag: invalid VLAN lists, access ports with no VLAN, a PVID
  outside the tagged list, mismatched link-types on the two ends of a link, and
  VLANs present on only one side.

### Bonding / link aggregation

1. Select the device, then in the right panel tick **2 or more ports** to bundle
   (ports that already have their own link can't be ticked).
2. Click **Jadikan trunk** (*Make trunk*). The name follows the device's OS:

   | Vendor | Automatic name |
   |---|---|
   | Huawei (VRP) | `Eth-Trunk1`, `Eth-Trunk2`, … |
   | Juniper (Junos) | `ae0`, `ae1`, … |
   | MikroTik (RouterOS) | `bond1`, `bond2`, … |
   | Others | `lag1`, `lag2`, … |

3. On the canvas the trunk appears as **one logical interface** (a wide,
   double-bordered box) labelled `2× 10G`; its member ports are hidden to keep
   the diagram clean. Draw a cable from trunk to trunk on the peer device just
   like a regular port.
4. The mode can be switched between **LACP (dynamic)** and **manual/static**,
   members can be added or removed at any time, and total capacity is computed
   automatically (`2× 10G = 20G`).
5. Automatic checks warn when a trunk has only 1 member, its members have
   different speeds, or the member counts on the two ends of a link don't match.

### Keyboard shortcuts

| Key | Action |
|---|---|
| `⌘/Ctrl + S` | Save |
| `⌘/Ctrl + Z` | Undo |
| `Shift + ⌘/Ctrl + Z` | Redo |
| `⌘/Ctrl + D` | Duplicate selection |
| `Delete` / `Backspace` | Delete selection |
| `Esc` | Clear selection, or close the open dialog |
| `?` | Help |

Scroll to pan the canvas, `⌥/Alt + scroll` to zoom, left-drag for box
selection, middle/right-drag to pan. Canvas shortcuts are ignored while a
dialog is open.

---

## AI assistant (optional)

NetTopo can connect to any OpenAI-compatible endpoint — for example 9Router, or
a local server such as Ollama. Without this setup, every other feature works as
normal.

### Setting up the key

```bash
cp .env.example .env
```

Open `.env`, fill in `AI_BASE_URL` and `AI_API_KEY`, then restart
`npm run dev`.

**The key never reaches the browser.** `.env` is read only by the dev server,
which adds it as an `Authorization` header when forwarding requests — so the key
doesn't show up in the Network tab, isn't bundled, and `.env` is already in
`.gitignore`. The browser only ever calls `/ai/...` on localhost.

![AI assistant reviewing a topology](docs/img/06-asisten-ai.png)

### The five tasks

| Task | Output |
|---|---|
| **Device configuration** | Paste-ready configuration per device in Junos / VRP / RouterOS syntax, built from the VLANs and trunks already documented |
| **Audit & suggestions** | Findings ranked by severity: single points of failure, backup paths that aren't diverse, unbalanced capacity, inconsistent naming |
| **Network documentation** | A Markdown document: architecture, device table, connection table, VLAN plan |
| **Tidy the drawing** | The AI decides grouping and direction; pixel placement is still done by the layout algorithm |
| **Build from a description** | Describe the design in plain sentences; devices and links are created from the catalog as a new project (the project you have open is not overwritten) |

Endpoints that respond with an SSE stream or with a single JSON object are both
supported; for long outputs the text appears progressively as it arrives.

The last two tasks change the canvas, and neither does it blindly. Tidying goes
into the undo history, so `Cmd/Ctrl + Z` reverts it. Building from a
description creates a separate project, and the previous one stays available
under **Buka** (*Open*). AI responses are always validated against a schema
first: models that aren't in the catalog, ports a device doesn't have, or
unknown hostnames are skipped and reported as warnings — never applied
silently.

### Privacy considerations

A summary of the topology — hostnames, management IPs, VLANs, and connection
details — is sent to the endpoint you configure. For sensitive topologies,
point `AI_BASE_URL` at a local model (e.g. `http://localhost:11434/v1`) so the
data never leaves your machine.

## Device catalog

<img src="docs/img/04-katalog.png" width="300" align="right" alt="Device catalog grouped by vendor">

The catalog contains **101 models** from 13 vendors, including **16 OLTs** for
FTTH networks. In the left panel each vendor can be collapsed so it doesn't fill
the screen — groups with search matches open by themselves, and which groups
are open is remembered.

| Vendor | Count | Example models | Interface naming |
|---|---|---|---|
| **Juniper** | 12 | MX204, MX304, MX480/960, MX10003, ACX7100, QFX5120, EX4600, EX4300, SRX4100 | `ge-0/0/x`, `xe-0/0/x`, `et-0/0/x` |
| **Huawei** | 18 | NE8000 M8, NE40E-M2K, S5731, S5720, S6730, CE6881, CE6865E, CE8850 · OLT MA5800-X2/X7/X15, MA5608T | `GE0/0/x`, `10GE1/0/x`, `100GE0/1/x`, `GPON0/1/x` |
| **MikroTik** | 30 | CCR1009/1016/1036/1072/2004/2116/2216, RB3011/4011/5009, hEX S, L009, CRS112/305/309/310/312/317/326/328/354/504/518, CSS326/610, netPower | `ether1..n`, `sfp-sfpplus1..n`, `sfp28-1..n` |
| **ZTE** | 5 | OLT C300, C320, C600, C650 · switch ZXR10 5960 | `gpon-olt_1/x/y`, `xgei_1/9/x`, `cei_1/9/x` |
| **Cisco** | 3 | ASR920-24SZ-M, ASR1001-X, Catalyst C9300-48P | `GigabitEthernet0/0/x`, `TenGigabitEthernet1/1/x` |
| **Ubiquiti** | 5 | EdgeRouter 4 & X, UniFi USW-Pro-24-PoE, USW-Aggregation, AP U6-Pro | `eth0..n`, `port1..n`, `sfpplus1..n` |
| **TP-Link** | 3 | TL-SG3428X, TL-SG2210P, MC220L | `Gi1/0/x`, `Te1/0/x` |
| **FiberHome** | 2 | OLT AN5516-01 · ONT AN5506-04-F | `gpon1/x/y`, `xge1/9/x` |
| **BDCOM** | 2 | OLT P3310B (EPON), P3608-2TE (GPON) | `EPON0/x`, `GPON0/x`, `GigaEthernet0/x` |
| **V-SOL** | 2 | OLT V1600D (EPON), V1600G2 (GPON) | `epon0/x`, `gpon0/x`, `ge0/x` |
| **C-Data** | 2 | OLT FD1216S, FD1104S | `gpon0/x`, `ge0/x`, `xge0/x` |
| **HTB** | 4 | HTB-GS-03, HTB-GS-03 A/B, HTB-1100S, HTB-3100 A/B | `fiber1`, `utp1` |
| **Generic** | 13 | Router, Switch, Firewall, Server, OLT, ODC, ODP, 1:8 Splitter, ONT, AP, Media Converter, CPE, Internet | free-form, ports added manually |

Port naming for Juniper, Huawei, MikroTik, ZTE, and Cisco follows each vendor's
official conventions. For **FiberHome, BDCOM, V-SOL, and C-Data** the naming is
a reasonable approximation and is flagged as such in each tooltip — compare it
with your device's `show interface` output, then adjust it in the port table in
the right panel or directly in the catalog.

Media converters have their own role, so auto-layout places them alongside the
access layer rather than down with the customer layer.

<br clear="right">

### Adding a new model

All hardware specs live in one file: [`src/data/deviceCatalog.ts`](src/data/deviceCatalog.ts).
Adding a model is a single entry:

```ts
{
  id: 'mikrotik-ccr2004-16g-2sp',        // unique, used in JSON files
  vendor: 'mikrotik',
  series: 'CCR2004',
  model: 'CCR2004-16G-2S+',
  role: 'router',                         // sets the icon, color, and auto-layout tier
  os: 'routeros',
  note: '16× GE + 2× SFP+ 10G',           // shown in the palette tooltip
  ports: [
    { prefix: 'ether',       count: 16, startIndex: 1, speed: '1G',  media: 'rj45', group: 'Ethernet' },
    { prefix: 'sfp-sfpplus', count: 2,  startIndex: 1, speed: '10G', media: 'sfp+', group: 'SFP+ 10G' },
  ],
}
```

- `prefix` + number + `suffix` form the interface name: `ether1`, `et-0/0/0`,
  `10GE1/0/1`, `qsfpplus1-1`, and so on.
- `startIndex` is **0** for Juniper and **1** for Huawei and MikroTik.
- Port names and counts can also be changed straight from the UI (the port
  table in the right panel) without touching code — those changes are saved per
  device.

Default port specs follow each model's common configuration. For modular
chassis (MX240/480/960/10003) a sample configuration is used, since the real
ports depend on the installed MPCs/MICs — adjust as needed.

---

## JSON file format

JSON export produces a document that can be imported again, kept in git, or
read by other scripts. Its structure (see [`src/types/topology.ts`](src/types/topology.ts)):

```jsonc
{
  "schemaVersion": 4,
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
      // An Eth-Trunk has its own link-type & VLANs, just like a physical port
      "trunks": [
        { "id": "trk_1", "name": "ae0", "mode": "lacp",
          "memberIds": ["p_3", "p_4"], "description": "", "side": "left",
          "linkType": "trunk", "pvid": 1, "allowedVlans": "1,100,200",
          "untaggedVlans": "", "ipAddress": "" }
      ]
    }
  ],
  "links": [
    // Each link end points at a physical port OR a trunk — exactly one is set.
    { "id": "lnk_1",
      "a": { "deviceId": "dev_1", "portId": "p_1", "trunkId": null },
      "b": { "deviceId": "dev_2", "portId": "p_9", "trunkId": null },
      "speed": "100G", "media": "fiber", "kind": "single",
      "label": "Core ↔ SSW", "vlans": "100,200", "color": null,
      // routing: bezier | smoothstep | straight
      "routing": "bezier", "waypoints": [{ "x": 420, "y": 180 }] },
    { "id": "lnk_2",
      "a": { "deviceId": "dev_1", "portId": "", "trunkId": "trk_1" },
      "b": { "deviceId": "dev_3", "portId": "", "trunkId": "trk_9" },
      "speed": "10G", "media": "fiber", "kind": "lacp",
      "label": "", "vlans": "", "color": null }
  ],
  "groups": [ /* area / POP boxes */ ],
  "notes":  [ /* sticky notes */ ]
}
```

Imported files are validated with zod; if something doesn't match, the app
names the offending field and leaves your current work untouched. Broken
references — duplicate IDs, links pointing at devices, ports, or trunks that
don't exist, missing trunk members, unknown parent groups — are dropped on
import, and the app tells you how many were removed. If an imported file has
the same project ID as one already saved, it gets a new ID so it can't
overwrite the saved copy.

Older files still open — **version 1** (before trunks), **2** (before VLANs),
and **3** (before bendable cables). New fields get default values, and the file
is saved back as version 4.

---

## Deploying to Vercel

The build output is static, so deploying is simple: connect this repo in the
Vercel dashboard, keep the default settings (Vercel detects Vite on its own),
and hit **Deploy**.

To enable the AI assistant, add these Environment Variables in Vercel —
Settings → Environment Variables:

| Name | Value |
|---|---|
| `AI_BASE_URL` | the OpenAI-compatible endpoint URL, e.g. `https://your-endpoint.example/v1` |
| `AI_API_KEY` | the API key from that endpoint's provider |
| `AI_ACCESS_CODE` | *(recommended for public deployments)* an access code of your choice, e.g. a long random phrase |

None of them use the **`VITE_` prefix**, and that's intentional: variables
prefixed with `VITE_` end up in the JavaScript files the browser downloads.
Without it, the values are only read at build time and by the server function.

AI requests from the browser go to `/ai/...` and are forwarded by the
[`api/ai/[...path].ts`](api/ai/) function, which adds the `Authorization`
header on the server side — exactly what the dev server does during
development. The function runs on the Edge runtime and streams the response
through, so long answers start appearing within seconds.

The proxy only forwards the two calls the app uses (`GET /models` and
`POST /chat/completions`), only from the app's own pages, and rejects request
bodies over 2 MB — the rules live in [`src/lib/aiGuard.ts`](src/lib/aiGuard.ts)
and are shared with the dev server.

> **Important for public deployments:** without `AI_ACCESS_CODE`, anyone who
> opens your deployment can use the AI assistant on your key — and the origin
> check can be spoofed from `curl`. With `AI_ACCESS_CODE` set, the proxy rejects
> every request that doesn't carry the code. Users enter it once in the
> **Kode akses** (*Access code*) field of the AI dialog; it is stored in their
> own browser and is never forwarded to the AI provider. Share the code only
> with people who should use the AI, and change it (then redeploy) if it leaks.
>
> Also set a quota or spending limit on the key at the provider as a last line
> of defense.

Verified: with the variables set, the built app detects the AI as ready, and
neither the key nor the access code appears anywhere in the bundle.

Without `AI_BASE_URL` and `AI_API_KEY` the app still works normally — the AI
button just shows setup instructions.

---

## Updating the screenshots

The images in this README are regenerated by a script rather than captured by
hand, so they stay consistent and are easy to refresh when the UI changes:

```bash
npm run dev                       # in another terminal
npm install --no-save playwright
node scripts/screenshots.mjs
```

The script uses the Chrome already installed on your system, so no separate
browser download is needed. Playwright is deliberately not a permanent
dependency because it's only needed when updating the docs.

---

## Code structure

```
src/
├─ types/topology.ts        # types + zod schema + color palette
├─ data/deviceCatalog.ts    # vendor/model/port catalog  ← edit here to add devices
├─ data/sampleTopology.ts   # sample topology shown on first launch
├─ store/useTopologyStore.ts# canvas state, undo/redo, port connection rules
├─ store/useUiStore.ts      # theme, panels, display preferences
├─ components/              # Toolbar, DevicePalette, Canvas, nodes, edges, Inspector
└─ lib/                     # ports, layout (dagre), serialize, persistence, export, validate, AI
```

---

## Not yet available (roadmap)

- Live monitoring: up/down colors per device and link via ping/SNMP.
- LLDP/SNMP auto-discovery to draw topologies automatically.
- A multi-user backend with login and change history.

The data model is already prepared for this: it only needs a backend that
sends status per `deviceId`/`linkId`, with no change to the file format.

---

## License

[MIT](LICENSE) — free to use, modify, and distribute, including for commercial
purposes. The only requirement is to include the copyright notice and the
license text. The software is provided as is, without warranty.

All dependencies use permissive, compatible licenses: MIT (React, React Flow,
dagre, zustand, zod, Tailwind, Vite, Vitest, html-to-image), ISC
(lucide-react), and Apache-2.0 (TypeScript).

### Trademark notice

The vendor and device model names in the catalog — Juniper, Huawei, MikroTik,
ZTE, Cisco, Ubiquiti, TP-Link, FiberHome, BDCOM, V-SOL, C-Data, HTB — are
trademarks of their respective owners, used here solely as references so your
network documentation matches real hardware. This project is not affiliated
with, endorsed by, or sponsored by any of the companies above.
