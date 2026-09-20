let counter = 0

/** Id pendek, stabil dalam satu sesi, aman dipakai sebagai key React & id handle. */
export function uid(prefix: string): string {
  counter += 1
  const rand = Math.random().toString(36).slice(2, 8)
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rand}`
}
