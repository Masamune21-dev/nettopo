import { getNodesBounds, getViewportForBounds, type Node } from '@xyflow/react'
import { toPng, toSvg } from 'html-to-image'
import { downloadBlob, downloadText } from './download'

const PADDING = 60

function viewportElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.react-flow__viewport')
}

function frame(nodes: Node[]) {
  const bounds = getNodesBounds(nodes)
  const width = Math.max(480, Math.ceil(bounds.width) + PADDING * 2)
  const height = Math.max(360, Math.ceil(bounds.height) + PADDING * 2)
  const vp = getViewportForBounds(bounds, width, height, 0.2, 2, PADDING / 2)
  return { width, height, vp }
}

/** Ekspor kanvas jadi PNG 2× untuk laporan. */
export async function exportPng(nodes: Node[], filename: string): Promise<void> {
  const el = viewportElement()
  if (!el) throw new Error('Kanvas belum siap.')
  const { width, height, vp } = frame(nodes)
  const bg = getComputedStyle(document.body).getPropertyValue('--canvas').trim() || '#ffffff'
  const dataUrl = await toPng(el, {
    backgroundColor: bg,
    width,
    height,
    pixelRatio: 2,
    style: {
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`,
    },
  })
  const blob = await (await fetch(dataUrl)).blob()
  downloadBlob(blob, filename)
}

/** Ekspor kanvas jadi SVG vektor untuk dokumen. */
export async function exportSvg(nodes: Node[], filename: string): Promise<void> {
  const el = viewportElement()
  if (!el) throw new Error('Kanvas belum siap.')
  const { width, height, vp } = frame(nodes)
  const bg = getComputedStyle(document.body).getPropertyValue('--canvas').trim() || '#ffffff'
  const dataUrl = await toSvg(el, {
    backgroundColor: bg,
    width,
    height,
    style: {
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`,
    },
  })
  const svg = decodeURIComponent(dataUrl.replace('data:image/svg+xml;charset=utf-8,', ''))
  downloadText(svg, filename, 'image/svg+xml')
}
