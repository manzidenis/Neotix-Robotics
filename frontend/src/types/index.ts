export interface User {
  id: number
  username: string
  email: string
  created_at: string
}

export interface Dataset {
  id: number
  user_id: number | null
  name: string
  path: string
  is_active: boolean
  robot_type: 'single' | 'bimanual'
  total_episodes: number
  total_frames: number
  fps: number
  cameras: string[]
  source: 'original' | 'export' | 'merge'
  created_at: string
  updated_at: string
  tasks?: Record<string, string>
}

export type EpisodeStatus = 'unreviewed' | 'validated' | 'deleted' | 'flagged'

export interface Episode {
  id: number
  dataset_id: number
  episode_index: number
  status: EpisodeStatus
  task_label: string
  task_index: number
  duration: number
  frame_count: number
  cameras?: string[]
  created_at: string
  updated_at: string
}

export interface EpisodeData {
  timestamps: number[]
  states: number[][]
  actions: number[][]
  joints: number
}

export interface ActivityItem {
  id: number
  username: string
  action: string
  details: string
  dataset_id: number | null
  episode_id: number | null
  created_at: string
}

export interface QAProgress {
  total: number
  reviewed: number
  unreviewed: number
  validated: number
  deleted: number
  flagged: number
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  page_size: number
  pages: number
}

export interface ReplayStatus {
  job_id: number
  status: 'pending' | 'running' | 'done' | 'error'
  progress: number
  error_message: string | null
}

export interface SimFrame {
  type: 'frame'
  data: string          // base64 JPEG
  frame_index: number
  total_frames: number
  timestamp: number
  camera: { azimuth: number; elevation: number; distance: number }
}

export interface SimInfo {
  type: 'info'
  episode_id: number
  total_frames: number
  bimanual: boolean
  joints: number
}
