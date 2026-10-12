import { ios } from './dialects/ios'
import { junos } from './dialects/junos'
import { linux } from './dialects/linux'
import { routeros } from './dialects/routeros'
import { vrp } from './dialects/vrp'
import type { Dialect, DialectId } from './types'

export { makeCtx, type Outcome, runLine, type World } from './engine'

const DIALECTS: Record<DialectId, Dialect> = { vrp, ios, junos, routeros, linux }

export const dialectById = (id: DialectId): Dialect => DIALECTS[id]
