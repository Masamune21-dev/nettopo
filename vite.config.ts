import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { AI_ACCESS_HEADER, AI_REASON_HEADER, checkAiRequest } from './src/lib/aiGuard.ts'

/**
 * Terapkan aturan akses /ai sebelum proxy di bawah menempelkan kunci API —
 * tanpa ini, situs lain yang dibuka di browser yang sama (atau siapa pun di
 * jaringan saat memakai --host) bisa menumpang kunci lewat dev server.
 */
function aiGuard(accessCode: string): Plugin {
  return {
    name: 'nettopo-ai-guard',
    configureServer(server) {
      // Didaftarkan langsung (bukan lewat fungsi kembalian) supaya berjalan
      // sebelum middleware proxy bawaan Vite.
      server.middlewares.use('/ai', (req, res, next) => {
        const header = (name: string) => {
          const v = req.headers[name]
          return Array.isArray(v) ? v[0] : (v ?? null)
        }
        const rejection = checkAiRequest({
          method: req.method ?? 'GET',
          path: (req.url ?? '').split('?')[0],
          host: header('host'),
          origin: header('origin'),
          secFetchSite: header('sec-fetch-site'),
          contentType: header('content-type'),
          contentLength: header('content-length'),
          accessCode,
          providedCode: header(AI_ACCESS_HEADER),
        })
        if (!rejection) return next()
        res.statusCode = rejection.status
        if (rejection.reason) res.setHeader(AI_REASON_HEADER, rejection.reason)
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: rejection.error }))
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  // Awalan kosong: baca semua variabel dari .env, bukan hanya yang VITE_*.
  // Yang berawalan VITE_ akan ikut ter-bundle ke browser — kunci API sengaja
  // TIDAK diberi awalan itu supaya tetap tinggal di sisi server.
  const env = loadEnv(mode, process.cwd(), '')
  const baseUrl = (env.AI_BASE_URL ?? '').replace(/\/+$/, '')
  const apiKey = env.AI_API_KEY ?? ''
  const accessCode = env.AI_ACCESS_CODE ?? ''

  return {
    plugins: [aiGuard(accessCode), react(), tailwindcss()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    // Hanya penanda siap/tidak yang sampai ke browser, bukan kuncinya.
    define: {
      __AI_READY__: JSON.stringify(Boolean(baseUrl && apiKey)),
      __AI_DEFAULT_MODEL__: JSON.stringify(env.AI_DEFAULT_MODEL ?? ''),
      __AI_NEEDS_CODE__: JSON.stringify(Boolean(accessCode)),
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy: baseUrl
        ? {
            // Browser memanggil /ai/... ; header Authorization ditempelkan di
            // sini, jadi kunci tidak pernah muncul di tab Network.
            '/ai': {
              target: baseUrl,
              changeOrigin: true,
              rewrite: (path) => path.replace(/^\/ai/, ''),
              configure: (proxy) => {
                proxy.on('proxyReq', (proxyReq) => {
                  if (apiKey) proxyReq.setHeader('Authorization', `Bearer ${apiKey}`)
                  // Kode akses hanya untuk penerus ini, bukan untuk penyedia AI.
                  proxyReq.removeHeader(AI_ACCESS_HEADER)
                })
              },
            },
          }
        : undefined,
    },
  }
})
