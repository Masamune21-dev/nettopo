import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  // Awalan kosong: baca semua variabel dari .env, bukan hanya yang VITE_*.
  // Yang berawalan VITE_ akan ikut ter-bundle ke browser — kunci API sengaja
  // TIDAK diberi awalan itu supaya tetap tinggal di sisi server.
  const env = loadEnv(mode, process.cwd(), '')
  const baseUrl = (env.AI_BASE_URL ?? '').replace(/\/+$/, '')
  const apiKey = env.AI_API_KEY ?? ''

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    // Hanya penanda siap/tidak yang sampai ke browser, bukan kuncinya.
    define: {
      __AI_READY__: JSON.stringify(Boolean(baseUrl && apiKey)),
      __AI_DEFAULT_MODEL__: JSON.stringify(env.AI_DEFAULT_MODEL ?? ''),
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
                })
              },
            },
          }
        : undefined,
    },
  }
})
