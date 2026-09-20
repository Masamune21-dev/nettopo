import {
  Cloud,
  GitFork,
  MonitorSmartphone,
  Network,
  Router,
  Server,
  ShieldCheck,
  Split,
  Waypoints,
} from 'lucide-react'
import type { ComponentType } from 'react'
import type { DeviceRole } from '@/types/topology'

const MAP: Record<DeviceRole, ComponentType<{ size?: number; strokeWidth?: number; className?: string }>> = {
  'core-router': Router,
  bng: Waypoints,
  ssw: Network,
  'metro-switch': Network,
  'access-switch': Network,
  router: Router,
  switch: Network,
  firewall: ShieldCheck,
  server: Server,
  olt: Split,
  internet: Cloud,
  cpe: MonitorSmartphone,
  passive: GitFork,
}

export function RoleIcon({
  role,
  size = 15,
  className,
}: {
  role: DeviceRole
  size?: number
  className?: string
}) {
  const Icon = MAP[role] ?? Network
  return <Icon size={size} strokeWidth={2} className={className} />
}
