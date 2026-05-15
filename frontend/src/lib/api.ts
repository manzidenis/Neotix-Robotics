import axios from 'axios'
import { useAuthStore } from '@/store'

const rawApiBase = (import.meta.env.VITE_API_BASE as string | undefined)?.trim()
const rawWsBase = (import.meta.env.VITE_WS_BASE as string | undefined)?.trim()
const rawAssetBase = (import.meta.env.VITE_ASSET_BASE as string | undefined)?.trim()

export const API_BASE = rawApiBase ? rawApiBase.replace(/\/+$/, '') : ''
export const WS_BASE = rawWsBase
  ? rawWsBase.replace(/\/+$/, '')
  : API_BASE
    ? API_BASE.replace(/^http/i, 'ws')
    : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`
export const ASSET_BASE = rawAssetBase
  ? rawAssetBase.replace(/\/+$/, '')
  : API_BASE

export function resolveAssetUrl(path: string) {
  if (/^https?:\/\//i.test(path)) return path
  if (!ASSET_BASE) return path
  return `${ASSET_BASE}${path.startsWith('/') ? path : `/${path}`}`
}

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 12000,
})

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const url: string = err.config?.url ?? ''
    const isAuthEndpoint = url.includes('/auth/login') || url.includes('/auth/register')
    if (err.response?.status === 401 && !isAuthEndpoint) {
      const { queryClient } = await import('@/queryClient')
      queryClient.clear()
      useAuthStore.getState().logout()
      window.location.href = '/'
    }
    return Promise.reject(err)
  }
)

// Auth
export const authApi = {
  register: (data: { username: string; email: string; password: string }) =>
    api.post('/auth/register', data).then((r) => r.data),
  login: (username: string, password: string) =>
    api.post('/auth/login', { username, password }).then((r) => r.data),
  me: () => api.get('/auth/me').then((r) => r.data),
}

// Datasets
export const datasetsApi = {
  list: () => api.get('/datasets').then((r) => r.data),
  get: (id: number) => api.get(`/datasets/${id}`).then((r) => r.data),
  scan: () => api.get('/datasets/scan').then((r) => r.data),
  importPath: (path: string, name: string) =>
    api.post('/datasets/import', { path, name }, { timeout: 120_000 }).then((r) => r.data),
  upload: (file: File, name: string) => {
    const form = new FormData()
    form.append('file', file)
    form.append('name', name)
    return api.post('/datasets/upload', form, { timeout: 300_000 }).then((r) => r.data)
  },
  uploadFolder: (files: File[] | FileList, name?: string) => {
    const form = new FormData()
    for (const file of Array.from(files)) {
      const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
      form.append('files', file, relativePath)
    }
    if (name?.trim()) form.append('name', name.trim())
    return api.post('/datasets/upload-folder', form, { timeout: 300_000 }).then((r) => r.data)
  },
  rename: (id: number, name: string) =>
    api.patch(`/datasets/${id}`, { name }).then((r) => r.data),
  delete: (id: number) => api.delete(`/datasets/${id}`).then((r) => r.data),
  activate: (id: number) => api.post(`/datasets/${id}/activate`).then((r) => r.data),
  merge: (dataset_ids: number[], output_name: string) =>
    api.post('/datasets/merge', { dataset_ids, output_name }, { timeout: 300_000 }).then((r) => r.data),
  mergeCheck: (dataset_ids: number[]) =>
    api.post('/datasets/merge/check', { dataset_ids }).then((r) => r.data),
}

export const episodesApi = {
  list: (params?: Record<string, unknown>) =>
    api.get('/episodes', { params }).then((r) => r.data),
  get: (id: number) => api.get(`/episodes/${id}`).then((r) => r.data),
  getData: (id: number) => api.get(`/episodes/${id}/data`).then((r) => r.data),
  videoUrl: (id: number, camera: string) => {
    const token = useAuthStore.getState().token
    return `${API_BASE}/episodes/${id}/video/${camera}${token ? `?token=${encodeURIComponent(token)}` : ''}`
  },
  setStatus: (id: number, status: string) =>
    api.patch(`/episodes/${id}/status`, { status }).then((r) => r.data),
  setTask: (id: number, task_label: string) =>
    api.patch(`/episodes/${id}/task`, { task_label }).then((r) => r.data),
  startReplay: (id: number) => api.post(`/episodes/${id}/replay`).then((r) => r.data),
  cancelReplay: (id: number) => api.post(`/episodes/${id}/replay/cancel`).then((r) => r.data),
  replayStatus: (id: number) => api.get(`/episodes/${id}/replay/status`).then((r) => r.data),
  replayVideoUrl: (id: number) => {
    const token = useAuthStore.getState().token
    return `${API_BASE}/episodes/${id}/replay/video${token ? `?token=${encodeURIComponent(token)}` : ''}`
  },
}

// QA
export const qaApi = {
  progress: () => api.get('/qa/progress').then((r) => r.data),
  export: (output_name: string, episode_ids?: number[]) =>
    api.post('/qa/export', { output_name, ...(episode_ids?.length ? { episode_ids } : {}) }, { timeout: 300_000 }).then((r) => r.data),
  downloadUrl: (datasetName: string) => {
    const token = useAuthStore.getState().token
    return `${API_BASE}/qa/export/${encodeURIComponent(datasetName)}/download${token ? `?token=${encodeURIComponent(token)}` : ''}`
  },
}

// Tasks / Stats / Activity
export const tasksApi = {
  list: () => api.get('/tasks').then((r) => r.data),
}

export const statsApi = {
  get: () => api.get('/stats').then((r) => r.data),
}

export const activityApi = {
  list: (params?: Record<string, unknown>) =>
    api.get('/activity', { params }).then((r) => r.data),
}
