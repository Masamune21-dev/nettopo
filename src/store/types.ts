import type { Edge, Node } from '@xyflow/react'
import type { DeviceRole, LinkKind, LinkMedia, Port, Speed } from '@/types/topology'

export type DeviceNodeData = {
  modelId: string
  hostname: string
  role: DeviceRole
  mgmtIp: string
  loopback: string
  site: string
  notes: string
  ports: Port[]
  expanded: boolean
}

export type GroupNodeData = { label: string; color: string }
export type NoteNodeData = { text: string; color: string }

export type DeviceNode = Node<DeviceNodeData, 'device'>
export type GroupNode = Node<GroupNodeData, 'group'>
export type NoteNode = Node<NoteNodeData, 'note'>
export type AppNode = DeviceNode | GroupNode | NoteNode

export type LinkEdgeData = {
  speed: Speed
  media: LinkMedia
  kind: LinkKind
  label: string
  vlans: string
  color: string | null
}

export type AppEdge = Edge<LinkEdgeData, 'link'>

export const isDeviceNode = (n: AppNode): n is DeviceNode => n.type === 'device'
export const isGroupNode = (n: AppNode): n is GroupNode => n.type === 'group'
export const isNoteNode = (n: AppNode): n is NoteNode => n.type === 'note'
