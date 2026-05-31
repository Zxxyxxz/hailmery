import { channelMeta } from '@/lib/channels'
import { cn } from '@/lib/utils'

export function ChannelIcon({
  channel,
  className,
}: {
  channel: string
  className?: string
}) {
  const meta = channelMeta(channel)
  const Icon = meta.icon
  return <Icon className={cn('h-4 w-4', meta.iconClass, className)} />
}
