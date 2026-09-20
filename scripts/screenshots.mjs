/**
 * Buat ulang tangkapan layar untuk README.
 *
 * Memakai Chrome yang sudah terpasang di sistem, jadi tidak perlu mengunduh
 * browser terpisah. Playwright tidak dijadikan dependensi tetap karena hanya
 * dibutuhkan saat memperbarui dokumentasi:
 *
 *   npm run dev                       # di terminal lain
 *   npm install --no-save playwright
 *   node scripts/screenshots.mjs
 */
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const URL = process.env.NETTOPO_URL ?? 'http://localhost:5173'
const OUT = 'docs/img'
const SIZE = { width: 1600, height: 1000 }

await mkdir(OUT, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: SIZE, deviceScaleFactor: 2, colorScheme: 'dark' })

const shot = async (name, opts = {}) => {
  await page.screenshot({ path: `${OUT}/${name}.png`, ...opts })
  console.log(`  ✓ ${name}.png`)
}

const settle = (ms = 900) => page.waitForTimeout(ms)

console.log(`Membuka ${URL} …`)
await page.goto(URL, { waitUntil: 'networkidle' })
// Mulai dari keadaan bersih supaya yang tampil selalu topologi contoh.
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('.react-flow__node-device')
await settle(2500)

console.log('Mengambil gambar …')

/* 1. Tampilan penuh */
await shot('01-tampilan-penuh')

/* 2. Perbesar ke inti Jakarta: node, port, badge VLAN, label kabel */
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('header button')].find((b) => b.title === 'Rapikan')
  btn?.click()
})
await settle(400)
await page.evaluate(() => {
  const item = [...document.querySelectorAll('div[class*=absolute] button')].find((b) =>
    /Paskan ke layar/.test(b.innerText),
  )
  item?.click()
})
await settle(1200)
await page.evaluate(() => {
  const zoomIn = document.querySelector('.react-flow__controls-zoomin')
  for (let i = 0; i < 3; i += 1) zoomIn?.click()
})
await settle(1200)
await shot('02-detail-perangkat', { clip: { x: 264, y: 52, width: 1000, height: 700 } })

/* 3. Panel properti perangkat: tabel port, VLAN, trunk */
const node = page.locator('.react-flow__node-device').filter({ hasText: 'SSW-JKT-01' }).first()
await node.click({ position: { x: 60, y: 12 } })
await settle(1200)
await page.waitForSelector('text=PROPERTI PERANGKAT')
await shot('03-panel-perangkat', { clip: { x: 1258, y: 52, width: 342, height: 940 } })

/* 4. Katalog — sengaja dibiarkan terlipat, karena itu yang mau ditunjukkan */
await settle(500)
await shot('04-katalog', { clip: { x: 0, y: 52, width: 264, height: 940 } })

/* Bersihkan kotak pencarian supaya tidak ada teks sisa di gambar berikutnya */
const clearSearch = async () => {
  await page.evaluate(() => {
    const input = document.querySelector('input[placeholder^="Cari host"]')
    if (!input) return
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, '')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.blur()
  })
  await settle(400)
}
await clearSearch()

const closeDialog = async () => {
  await page.evaluate(() => {
    const dialog = document.querySelector('[role=dialog]')
    const close = dialog?.querySelector('button svg')?.closest('button')
    close?.click()
  })
  await settle(700)
}

/* 5. Alamat IP */
await page.evaluate(() => {
  ;[...document.querySelectorAll('header button')].find((b) => /Alamat IP/.test(b.title))?.click()
})
await settle(1300)
await shot('05-alamat-ip')
await closeDialog()

/* 6. Asisten AI — dijalankan sungguhan supaya yang tampil hasil, bukan borang kosong */
await page.evaluate(() => {
  ;[...document.querySelectorAll('header button')].find((b) => /Asisten AI/.test(b.title))?.click()
})
await settle(2500)

const punyaModel = await page.evaluate(() => Boolean(document.querySelector('#ai-model')?.value))
if (punyaModel) {
  await page.evaluate(() => {
    const run = [...document.querySelectorAll('[role=dialog] button')].find((b) =>
      /Jalankan/.test(b.innerText),
    )
    run?.click()
  })
  // Tunggu sampai tombol "Batalkan" hilang, tanda prosesnya selesai.
  await page
    .waitForFunction(
      () =>
        ![...document.querySelectorAll('[role=dialog] button')].some((b) =>
          /Batalkan/.test(b.innerText),
        ),
      { timeout: 100_000 },
    )
    .catch(() => console.log('  ! AI belum selesai dalam batas waktu, gambar diambil apa adanya'))
  await settle(1000)
}
await shot('06-asisten-ai')

await browser.close()
console.log('Selesai.')
