import {
  FileText,
  Globe,
  Linkedin,
  Mail,
  Twitter,
  Instagram,
  Music2,
  Facebook,
  type LucideIcon,
} from 'lucide-react'

export interface ChannelMeta {
  key: string
  label: string
  icon: LucideIcon
  /** lucide icon tint */
  iconClass: string
  /** solid color for calendar dots (hex or gradient handled separately) */
  dotStyle: string
  /** true → calendar dot is the IG gradient */
  gradient?: boolean
  /** platform character limit for social composers (0 = none) */
  charLimit: number
  kind: 'social' | 'blog' | 'email'
}

export const CHANNELS: Record<string, ChannelMeta> = {
  linkedin: {
    key: 'linkedin',
    label: 'LinkedIn',
    icon: Linkedin,
    iconClass: 'text-blue-400',
    dotStyle: '#3b82f6',
    charLimit: 3000,
    kind: 'social',
  },
  twitter: {
    key: 'twitter',
    label: 'X',
    icon: Twitter,
    iconClass: 'text-gray-200',
    dotStyle: '#0b0b0d',
    charLimit: 280,
    kind: 'social',
  },
  // `x` is the channel key the composer emits; alias it to the same meta as
  // `twitter` so X drafts render "X" instead of the "Channel" fallback.
  x: {
    key: 'x',
    label: 'X',
    icon: Twitter,
    iconClass: 'text-gray-200',
    dotStyle: '#0b0b0d',
    charLimit: 280,
    kind: 'social',
  },
  instagram: {
    key: 'instagram',
    label: 'Instagram',
    icon: Instagram,
    iconClass: 'text-pink-400',
    dotStyle: 'linear-gradient(135deg,#a855f7,#ec4899)',
    gradient: true,
    charLimit: 2200,
    kind: 'social',
  },
  tiktok: {
    key: 'tiktok',
    label: 'TikTok',
    icon: Music2,
    iconClass: 'text-red-400',
    dotStyle: '#ef4444',
    charLimit: 2200,
    kind: 'social',
  },
  facebook: {
    key: 'facebook',
    label: 'Facebook',
    icon: Facebook,
    iconClass: 'text-blue-500',
    dotStyle: '#2563eb',
    charLimit: 63206,
    kind: 'social',
  },
  blog: {
    key: 'blog',
    label: 'Blog',
    icon: FileText,
    iconClass: 'text-emerald-400',
    dotStyle: '#10b981',
    charLimit: 0,
    kind: 'blog',
  },
  'wix-blog': {
    key: 'wix-blog',
    label: 'Blog',
    icon: Globe,
    iconClass: 'text-emerald-400',
    dotStyle: '#10b981',
    charLimit: 0,
    kind: 'blog',
  },
  email: {
    key: 'email',
    label: 'Email',
    icon: Mail,
    iconClass: 'text-orange-400',
    dotStyle: '#f97316',
    charLimit: 0,
    kind: 'email',
  },
  sendgrid: {
    key: 'sendgrid',
    label: 'Email',
    icon: Mail,
    iconClass: 'text-orange-400',
    dotStyle: '#f97316',
    charLimit: 0,
    kind: 'email',
  },
  gbp: {
    key: 'gbp',
    label: 'Google Business',
    icon: Globe,
    iconClass: 'text-blue-400',
    dotStyle: '#4285f4',
    charLimit: 1500,
    kind: 'social',
  },
}

const FALLBACK: ChannelMeta = {
  key: 'unknown',
  label: 'Channel',
  icon: Globe,
  iconClass: 'text-gray-400',
  dotStyle: '#6b7280',
  charLimit: 0,
  kind: 'social',
}

export function channelMeta(channel: string): ChannelMeta {
  return CHANNELS[channel] ?? FALLBACK
}

/** Channels offered in campaign/schedule multi-selects (deduped, no aliases). */
export const SELECTABLE_CHANNELS: ChannelMeta[] = [
  CHANNELS.linkedin,
  CHANNELS.twitter,
  CHANNELS.instagram,
  CHANNELS.tiktok,
  CHANNELS.facebook,
  CHANNELS.blog,
  CHANNELS.email,
]
