import { describe, expect, it } from 'vitest'
import { cell } from './exportCsv'

describe('cell', () => {
  it('menetralkan teks yang akan dibaca sebagai rumus', () => {
    expect(cell('=1+1')).toBe("'=1+1")
    expect(cell('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(cell('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`)
  })

  it('membiarkan angka dan teks biasa', () => {
    expect(cell(-5)).toBe('-5')
    expect(cell('MX204-01')).toBe('MX204-01')
    expect(cell(null)).toBe('')
  })

  it('mengutip koma, petik, dan pemisah baris termasuk \\r', () => {
    expect(cell('a,b')).toBe('"a,b"')
    expect(cell('a\rb')).toBe('"a\rb"')
    expect(cell('a\nb')).toBe('"a\nb"')
  })
})
