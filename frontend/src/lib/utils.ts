import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat().format(n)
}

export function relativeTime(dateStr: string): string {
  const normalized = /[Z+\-]\d{0,2}:?\d{0,2}$/.test(dateStr) ? dateStr : dateStr + 'Z'
  const diff = Date.now() - new Date(normalized).getTime()
  const seconds = Math.max(0, Math.floor(diff / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export const JOINT_COLORS = [
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
  '#f59e0b', '#10b981', '#ef4444', '#a78bfa',
  '#22d3ee', '#f472b6', '#34d399', '#fbbf24',
  '#60a5fa', '#f87171',
]

export function jointLabel(index: number, bimanual: boolean): string {
  if (!bimanual) {
    return index === 6 ? 'gripper' : `joint${index + 1}`
  }
  if (index < 6) return `L_joint${index + 1}`
  if (index === 6) return 'L_gripper'
  if (index < 13) return `R_joint${index - 6}`
  return 'R_gripper'
}
