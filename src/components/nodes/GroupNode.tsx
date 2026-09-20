import { type NodeProps, NodeResizer } from '@xyflow/react'
import { memo } from 'react'
import type { GroupNode as GroupNodeType } from '@/store/types'

function GroupNodeInner({ data, selected }: NodeProps<GroupNodeType>) {
  return (
    <>
      <NodeResizer
        color={data.color}
        isVisible={selected}
        minWidth={200}
        minHeight={140}
        lineStyle={{ borderWidth: 1 }}
        handleStyle={{ width: 8, height: 8, borderRadius: 2 }}
      />
      <div
        className="size-full rounded-xl border-2 border-dashed"
        style={{
          borderColor: data.color,
          background: `${data.color}0f`,
        }}
      >
        <span
          className="absolute -top-2.5 left-3 rounded px-1.5 py-[1px] text-[10px] font-semibold"
          style={{ background: data.color, color: '#fff' }}
        >
          {data.label}
        </span>
      </div>
    </>
  )
}

export const GroupNode = memo(GroupNodeInner)
