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

export interface DatasetUploadJob {
  id: number
  dataset_name: string
  source_filename: string
  status: 'initiated' | 'uploaded' | 'processing' | 'done' | 'error' | 'aborted'
  progress: number
  dataset_id: number | null
  error_message: string | null
  part_size_bytes: number
  total_parts: number
  created_at: string
  updated_at: string
}

export interface DatasetZipUploadProgress {
  phase: 'starting' | 'uploading' | 'processing' | 'done'
  uploadPercent: number
  ingestPercent: number
  status: DatasetUploadJob['status'] | 'uploading'
}

const MAX_PARALLEL_PART_UPLOADS = 4

export function resolveAssetUrl(path: string) {
  if (/^https?:\/\//i.test(path)) return path
  if (!ASSET_BASE) return path
  return `${ASSET_BASE}${path.startsWith('/') ? path : `/${path}`}`
}

function uploadPartToPresignedUrl(
  url: string,
  blob: Blob,
  onProgress?: (loaded: number) => void,
) {
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    let lastLoaded = 0

    xhr.open('PUT', url)
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return
      const delta = event.loaded - lastLoaded
      lastLoaded = event.loaded
      if (delta > 0) onProgress?.(delta)
    }
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`Part upload failed with status ${xhr.status}`))
        return
      }
      if (blob.size > lastLoaded) {
        onProgress?.(blob.size - lastLoaded)
        lastLoaded = blob.size
      }
      const etag = xhr.getResponseHeader('ETag')?.replace(/^"(.*)"$/, '$1')
      if (!etag) {
        reject(new Error('Missing ETag on upload response. Configure R2 CORS to expose the ETag header.'))
        return
      }
      resolve(etag)
    }
    xhr.onerror = () => reject(new Error('Part upload failed'))
    xhr.send(blob)
  })
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
  uploadZipDirect: async (
    file: File,
    name: string,
    onProgress?: (progress: DatasetZipUploadProgress) => void,
  ) => {
    const init = await api.post('/datasets/upload-jobs/init', {
      dataset_name: name,
      filename: file.name,
      file_size: file.size,
      content_type: file.type || 'application/zip',
    })
    const job = init.data as DatasetUploadJob
    const partSize = Math.max(job.part_size_bytes, 5 * 1024 * 1024)
    const totalParts = Math.max(job.total_parts, 1)
    const completedParts: Array<{ part_number: number; etag: string }> = []
    let uploadedBytes = 0
    let nextPartNumber = 1

    onProgress?.({ phase: 'starting', uploadPercent: 0, ingestPercent: 0, status: job.status })

    const emitUploadProgress = () => {
      onProgress?.({
        phase: 'uploading',
        uploadPercent: Math.min(100, Math.round((uploadedBytes / file.size) * 100)),
        ingestPercent: 0,
        status: 'uploading',
      })
    }

    const uploadNextPart = async () => {
      while (nextPartNumber <= totalParts) {
        const partNumber = nextPartNumber
        nextPartNumber += 1

        const start = (partNumber - 1) * partSize
        const end = Math.min(start + partSize, file.size)
        const chunk = file.slice(start, end)

        const partResp = await api.post(`/datasets/upload-jobs/${job.id}/parts`, { part_number: partNumber })
        const etag = await uploadPartToPresignedUrl(partResp.data.url, chunk, (delta) => {
          uploadedBytes += delta
          emitUploadProgress()
        })
        completedParts.push({ part_number: partNumber, etag })
        emitUploadProgress()
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(MAX_PARALLEL_PART_UPLOADS, totalParts) }, () => uploadNextPart()),
    )

    const complete = await api.post(`/datasets/upload-jobs/${job.id}/complete`, { parts: completedParts })
    let currentJob = complete.data as DatasetUploadJob

    while (!['done', 'error', 'aborted'].includes(currentJob.status)) {
      onProgress?.({
        phase: 'processing',
        uploadPercent: 100,
        ingestPercent: currentJob.progress,
        status: currentJob.status,
      })
      await new Promise((resolve) => setTimeout(resolve, 2000))
      const statusResp = await api.get(`/datasets/upload-jobs/${job.id}`)
      currentJob = statusResp.data as DatasetUploadJob
    }

    if (currentJob.status !== 'done') {
      throw new Error(currentJob.error_message || 'Dataset ingest failed')
    }

    onProgress?.({
      phase: 'done',
      uploadPercent: 100,
      ingestPercent: 100,
      status: currentJob.status,
    })

    return currentJob
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
