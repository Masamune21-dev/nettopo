import { getBezierPath, getSmoothStepPath, getStraightPath, Position } from '@xyflow/react'
import type { RoutingMode, Waypoint } from '@/types/topology'

export interface EdgeGeometry {
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  sourcePosition: Position
  targetPosition: Position
  routing: RoutingMode
  waypoints: Waypoint[]
}

/**
 * Arah keluar kabel dihitung dari posisi relatif kedua ujung, bukan dari sisi
 * handle-nya — tanpa ini kabel sering melingkar balik saat port berada di sisi
 * yang "salah" terhadap perangkat lawannya. Titik belok pertama/terakhir ikut
 * diperhitungkan supaya kabel keluar ke arah belokan.
 */
export function endpointDirections(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  waypoints: Waypoint[],
): { sourcePosition: Position; targetPosition: Position } {
  const first = waypoints[0] ?? { x: targetX, y: targetY }
  const last = waypoints.at(-1) ?? { x: sourceX, y: sourceY }
  return {
    sourcePosition: directionTo(sourceX, sourceY, first.x, first.y),
    targetPosition: directionTo(targetX, targetY, last.x, last.y),
  }
}

function directionTo(fromX: number, fromY: number, toX: number, toY: number): Position {
  const dx = toX - fromX
  const dy = toY - fromY
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? Position.Right : Position.Left
  return dy >= 0 ? Position.Bottom : Position.Top
}

/** Spline Catmull-Rom yang diubah jadi rangkaian kurva bezier kubik. */
function splinePath(points: Waypoint[]): string {
  if (points.length < 2) return ''
  const d: string[] = [`M ${points[0]!.x},${points[0]!.y}`]
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i]!
    const p1 = points[i]!
    const p2 = points[i + 1]!
    const p3 = points[i + 2] ?? p2
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 }
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 }
    d.push(`C ${c1.x},${c1.y} ${c2.x},${c2.y} ${p2.x},${p2.y}`)
  }
  return d.join(' ')
}

/** Garis patah dengan sudut ditumpulkan — untuk gaya siku dan lurus. */
function polylinePath(points: Waypoint[], radius: number): string {
  if (points.length < 2) return ''
  if (radius <= 0 || points.length === 2) {
    return `M ${points.map((p) => `${p.x},${p.y}`).join(' L ')}`
  }

  const d: string[] = [`M ${points[0]!.x},${points[0]!.y}`]
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1]!
    const cur = points[i]!
    const next = points[i + 1]!
    const r = Math.min(radius, dist(prev, cur) / 2, dist(cur, next) / 2)
    const a = lerpTowards(cur, prev, r)
    const b = lerpTowards(cur, next, r)
    d.push(`L ${a.x},${a.y}`, `Q ${cur.x},${cur.y} ${b.x},${b.y}`)
  }
  const end = points.at(-1)!
  d.push(`L ${end.x},${end.y}`)
  return d.join(' ')
}

const dist = (a: Waypoint, b: Waypoint) => Math.hypot(b.x - a.x, b.y - a.y)

function lerpTowards(from: Waypoint, to: Waypoint, distance: number): Waypoint {
  const len = dist(from, to) || 1
  const t = Math.min(1, distance / len)
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }
}

/** Titik tengah sepanjang garis — tempat label digantung. */
function midpointOf(points: Waypoint[]): [number, number] {
  if (points.length === 0) return [0, 0]
  const total = points.slice(1).reduce((sum, p, i) => sum + dist(points[i]!, p), 0)
  let walked = 0
  for (let i = 0; i < points.length - 1; i += 1) {
    const seg = dist(points[i]!, points[i + 1]!)
    if (walked + seg >= total / 2) {
      const t = seg === 0 ? 0 : (total / 2 - walked) / seg
      return [
        points[i]!.x + (points[i + 1]!.x - points[i]!.x) * t,
        points[i]!.y + (points[i + 1]!.y - points[i]!.y) * t,
      ]
    }
    walked += seg
  }
  const last = points.at(-1)!
  return [last.x, last.y]
}

/**
 * Bentuk jalur kabel. Tanpa titik belok dipakai perhitungan bawaan React Flow;
 * begitu ada titik belok, jalurnya dibangun sendiri agar melewati titik itu.
 */
export function buildEdgePath(g: EdgeGeometry): [path: string, labelX: number, labelY: number] {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, routing } = g

  if (g.waypoints.length === 0) {
    const [path, labelX, labelY] =
      routing === 'straight'
        ? getStraightPath({ sourceX, sourceY, targetX, targetY })
        : routing === 'smoothstep'
          ? getSmoothStepPath({
              sourceX,
              sourceY,
              targetX,
              targetY,
              sourcePosition,
              targetPosition,
              borderRadius: 10,
            })
          : getBezierPath({
              sourceX,
              sourceY,
              sourcePosition,
              targetX,
              targetY,
              targetPosition,
              curvature: 0.3,
            })
    return [path, labelX, labelY]
  }

  const points: Waypoint[] = [
    { x: sourceX, y: sourceY },
    ...g.waypoints,
    { x: targetX, y: targetY },
  ]
  const [labelX, labelY] = midpointOf(points)
  const path =
    routing === 'bezier'
      ? splinePath(points)
      : polylinePath(points, routing === 'smoothstep' ? 12 : 0)
  return [path, labelX, labelY]
}
