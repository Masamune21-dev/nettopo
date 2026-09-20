import { type NodeProps, NodeResizer } from '@xyflow/react'
import { memo } from 'react'
import { useTopologyStore } from '@/store/useTopologyStore'
import type { NoteNode as NoteNodeType } from '@/store/types'

function NoteNodeInner({ id, data, selected }: NodeProps<NoteNodeType>) {
  const updateNodeData = useTopologyStore((s) => s.updateNodeData)
  return (
    <>
      <NodeResizer isVisible={selected} minWidth={140} minHeight={90} color="#f59e0b" />
      <div
        className="size-full rounded-md border p-1.5 shadow-sm"
        style={{ background: data.color, borderColor: '#00000018' }}
      >
        <textarea
          className="nodrag size-full resize-none bg-transparent text-[11px] leading-snug text-slate-900 outline-none"
          value={data.text}
          placeholder="Tulis catatan…"
          onChange={(e) => updateNodeData(id, { text: e.target.value })}
        />
      </div>
    </>
  )
}

export const NoteNode = memo(NoteNodeInner)
