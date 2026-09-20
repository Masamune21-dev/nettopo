import type { InternalNode, Node } from '@xyflow/react'

export interface StraightenPlan {
  /** Node yang digeser supaya kedua ujung kabel sejajar. */
  nodeId: string
  dx: number
  dy: number
  /** Kabel mendatar diluruskan pada sumbu Y, kabel tegak pada sumbu X. */
  axis: 'y' | 'x'
}

function handleCenter(
  node: InternalNode<Node> | undefined,
  handleId: string | null | undefined,
): { x: number; y: number } | null {
  if (!node || !handleId) return null
  const bounds = node.internals.handleBounds
  const all = [...(bounds?.source ?? []), ...(bounds?.target ?? [])]
  const h = all.find((b) => b.id === handleId)
  if (!h) return null
  return {
    x: node.internals.positionAbsolute.x + h.x + h.width / 2,
    y: node.internals.positionAbsolute.y + h.y + h.height / 2,
  }
}

/**
 * Hitung geseran yang membuat sebuah kabel benar-benar lurus.
 *
 * Kabel tidak bisa diluruskan dengan mengubah gambarnya, karena kedua
 * ujungnya menempel di port. Yang digeser justru perangkatnya: cukup beberapa
 * piksel agar kedua port berada pada garis yang sama. Node yang digeser adalah
 * `moveNodeId` bila diberikan, selain itu sisi tujuan.
 */
export function planStraighten(
  source: InternalNode<Node> | undefined,
  sourceHandle: string | null | undefined,
  target: InternalNode<Node> | undefined,
  targetHandle: string | null | undefined,
  moveNodeId?: string,
): StraightenPlan | null {
  const a = handleCenter(source, sourceHandle)
  const b = handleCenter(target, targetHandle)
  if (!a || !b || !source || !target) return null

  const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)
  const moveTarget = moveNodeId ? moveNodeId === target.id : true
  const movedId = moveTarget ? target.id : source.id
  // Selisihnya dibalik arah kalau yang digeser justru sisi sumber.
  const sign = moveTarget ? 1 : -1

  if (horizontal) {
    const dy = Math.round((a.y - b.y) * sign)
    return dy === 0 ? null : { nodeId: movedId, dx: 0, dy, axis: 'y' }
  }
  const dx = Math.round((a.x - b.x) * sign)
  return dx === 0 ? null : { nodeId: movedId, dx, dy: 0, axis: 'x' }
}
