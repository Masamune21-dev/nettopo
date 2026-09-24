import { describe, expect, it } from 'vitest'
import { isDeviceNode } from '@/store/types'
import { applyBuildPlan } from './aiApply'
import { buildPlanSchema } from './aiTasks'

describe('applyBuildPlan', () => {
  it('menyambung link walau hostname dari AI berspasi di ujung', () => {
    const plan = buildPlanSchema.parse({
      devices: [
        { hostname: 'CORE-01 ', modelId: 'juniper-mx204' },
        { hostname: 'CORE-02', modelId: 'juniper-mx204' },
      ],
      links: [{ aHost: 'CORE-01', aPort: 'et-0/0/0', bHost: 'CORE-02 ', bPort: 'et-0/0/0', speed: '100G' }],
    })
    const result = applyBuildPlan(plan)
    expect(result.edges).toHaveLength(1)
    expect(result.nodes.filter(isDeviceNode).map((n) => n.data.hostname)).toEqual(['CORE-01', 'CORE-02'])
  })
})
