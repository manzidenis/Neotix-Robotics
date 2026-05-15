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

export interface DatasetFolderUploadProgress {
  phase: 'starting' | 'uploading' | 'finalizing' | 'done'
  uploadPercent: number
  filesUploaded: number
  totalFiles: number
}

const MAX_PARALLEL_PART_UPLOADS = 4
const MAX_PARALLEL_FILE_UPLOADS = 6
const FOLDER_PREPARE_BATCH_SIZE = 64
const DATASET_CONTROL_TIMEOUT_MS = 300_000
const R2_UPLOAD_REQUEST_TIMEOUT_MS = 900_000
const MAX_R2_UPLOAD_RETRIES = 2

export function resolveAssetUrl(path: string) {
  if (/^https?:\/\//i.test(path)) return path
  if (!ASSET_BASE) return path
  return `${ASSET_BASE}${path.startsWith('/') ? path : `/${path}`}`
}

function uploadBlobToPresignedUrl(
  url: string,
  blob: Blob,
  onProgress?: (loaded: number) => void,
) {
  const uploadOnce = () => new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    let lastLoaded = 0
    let settled = false

    const rollbackProgress = () => {
      if (lastLoaded > 0) {
        onProgress?.(-lastLoaded)
        lastLoaded = 0
      }
    }

    const fail = (message: string) => {
      if (settled) return
      settled = true
      rollbackProgress()
      reject(new Error(message))
    }

    xhr.open('PUT', url)
    xhr.timeout = R2_UPLOAD_REQUEST_TIMEOUT_MS
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return
      const delta = event.loaded - lastLoaded
      lastLoaded = event.loaded
      if (delta > 0) onProgress?.(delta)
    }
    xhr.onload = () => {
      if (settled) return
      if (xhr.status < 200 || xhr.status >= 300) {
        fail(`Upload failed with status ${xhr.status}`)
        return
      }
      if (blob.size > lastLoaded) {
        onProgress?.(blob.size - lastLoaded)
        lastLoaded = blob.size
      }
      const etag = xhr.getResponseHeader('ETag')?.replace(/^"(.*)"$/, '$1')
      if (!etag) {
        fail('Missing ETag on upload response. Configure R2 CORS to expose the ETag header.')
        return
      }
      settled = true
      resolve(etag)
    }
    xhr.onerror = () => fail('Upload failed')
    xhr.onabort = () => fail('Upload aborted')
    xhr.ontimeout = () => fail('Upload timed out')
    xhr.send(blob)
  })

  return (async () => {
    let attempt = 0
    let lastError: Error | null = null
    while (attempt <= MAX_R2_UPLOAD_RETRIES) {
      try {
        return await uploadOnce()
      } catch (error) {
        lastError = error as Error
        if (attempt === MAX_R2_UPLOAD_RETRIES) break
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)))
      }
      attempt += 1
    }
    throw lastError ?? new Error('Upload failed')
  })()
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
    }, { timeout: DATASET_CONTROL_TIMEOUT_MS })
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

        const partResp = await api.post(
          `/datasets/upload-jobs/${job.id}/parts`,
          { part_number: partNumber },
          { timeout: DATASET_CONTROL_TIMEOUT_MS },
        )
        const etag = await uploadBlobToPresignedUrl(partResp.data.url, chunk, (delta) => {
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

    const complete = await api.post(
      `/datasets/upload-jobs/${job.id}/complete`,
      { parts: completedParts },
      { timeout: DATASET_CONTROL_TIMEOUT_MS },
    )
    let currentJob = complete.data as DatasetUploadJob

    while (!['done', 'error', 'aborted'].includes(currentJob.status)) {
      onProgress?.({
        phase: 'processing',
        uploadPercent: 100,
        ingestPercent: currentJob.progress,
        status: currentJob.status,
      })
      await new Promise((resolve) => setTimeout(resolve, 2000))
      const statusResp = await api.get(`/datasets/upload-jobs/${job.id}`, { timeout: DATASET_CONTROL_TIMEOUT_MS })
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
  uploadFolderDirect: async (
    files: File[] | FileList,
    name: string,
    onProgress?: (progress: DatasetFolderUploadProgress) => void,
  ) => {
    const entries = Array.from(files).map((file) => {
      const rawRelative = ((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name).replace(/\\/g, '/')
      const parts = rawRelative.split('/').filter(Boolean)
      const relativePath = parts.length > 1 && parts[0] === name ? parts.slice(1).join('/') : rawRelative
      return { file, relativePath }
    }).sort((a, b) => b.file.size - a.file.size)

    const totalBytes = entries.reduce((sum, entry) => sum + entry.file.size, 0) || 1
    let uploadedBytes = 0
    let uploadedFiles = 0

    onProgress?.({ phase: 'starting', uploadPercent: 0, filesUploaded: 0, totalFiles: entries.length })

    await api.post(
      '/datasets/folder-upload/start',
      { dataset_name: name },
      { timeout: DATASET_CONTROL_TIMEOUT_MS },
    )

    const emitProgress = () => {
      onProgress?.({
        phase: 'uploading',
        uploadPercent: Math.min(100, Math.round((uploadedBytes / totalBytes) * 100)),
        filesUploaded: uploadedFiles,
        totalFiles: entries.length,
      })
    }

    const uploadMultipartFile = async (
      entry: { file: File; relativePath: string },
      uploadId: string,
      partSize: number,
      partUrls: Array<{ part_number: number; url: string }>,
    ) => {
      const completedParts: Array<{ part_number: number; etag: string }> = []
      let nextPartIndex = 0

      const uploadNextPart = async () => {
        while (nextPartIndex < partUrls.length) {
          const currentPartIndex = nextPartIndex
          nextPartIndex += 1
          const part = partUrls[currentPartIndex]
          const start = (part.part_number - 1) * partSize
          const end = Math.min(start + partSize, entry.file.size)
          const chunk = entry.file.slice(start, end)
          const etag = await uploadBlobToPresignedUrl(part.url, chunk, (delta) => {
            uploadedBytes += delta
            emitProgress()
          })
          completedParts.push({ part_number: part.part_number, etag })
          emitProgress()
        }
      }

      await Promise.all(
        Array.from({ length: Math.min(MAX_PARALLEL_PART_UPLOADS, partUrls.length) }, () => uploadNextPart()),
      )

      await api.post(
        '/datasets/folder-upload/file-complete',
        {
          dataset_name: name,
          relative_path: entry.relativePath,
          upload_id: uploadId,
          parts: completedParts,
        },
        { timeout: DATASET_CONTROL_TIMEOUT_MS },
      )
    }

    try {
      for (let startIndex = 0; startIndex < entries.length; startIndex += FOLDER_PREPARE_BATCH_SIZE) {
        const batch = entries.slice(startIndex, startIndex + FOLDER_PREPARE_BATCH_SIZE)
        const prepare = await api.post(
          '/datasets/folder-upload/prepare-batch',
          {
            dataset_name: name,
            files: batch.map(({ file, relativePath }) => ({
              relative_path: relativePath,
              size: file.size,
              content_type: file.type || 'application/octet-stream',
            })),
          },
          { timeout: DATASET_CONTROL_TIMEOUT_MS },
        )

        const specs = new Map<string, any>(
          (prepare.data.uploads as Array<any>).map((item) => [item.relative_path, item]),
        )

        let nextIndex = 0
        const uploadNextFile = async () => {
          while (nextIndex < batch.length) {
            const currentIndex = nextIndex
            nextIndex += 1
            const entry = batch[currentIndex]
            const spec = specs.get(entry.relativePath)
            if (!spec) {
              throw new Error(`Missing upload spec for ${entry.relativePath}`)
            }

            if (spec.mode === 'multipart') {
              try {
                await uploadMultipartFile(entry, spec.upload_id, spec.part_size_bytes, spec.part_urls)
              } catch (error) {
                try {
                  await api.post(
                    '/datasets/folder-upload/file-abort',
                    {
                      dataset_name: name,
                      relative_path: entry.relativePath,
                      upload_id: spec.upload_id,
                    },
                    { timeout: DATASET_CONTROL_TIMEOUT_MS },
                  )
                } catch {
                  // Best effort cleanup.
                }
                throw error
              }
            } else {
              await uploadBlobToPresignedUrl(spec.url, entry.file, (delta) => {
                uploadedBytes += delta
                emitProgress()
              })
            }

            uploadedFiles += 1
            uploadedBytes = Math.min(totalBytes, uploadedBytes)
            emitProgress()
          }
        }

        await Promise.all(
          Array.from({ length: Math.min(MAX_PARALLEL_FILE_UPLOADS, batch.length) }, () => uploadNextFile()),
        )
      }

      onProgress?.({
        phase: 'finalizing',
        uploadPercent: 100,
        filesUploaded: entries.length,
        totalFiles: entries.length,
      })

      const complete = await api.post(
        '/datasets/folder-upload/complete',
        { dataset_name: name },
        { timeout: DATASET_CONTROL_TIMEOUT_MS },
      )
      onProgress?.({
        phase: 'done',
        uploadPercent: 100,
        filesUploaded: entries.length,
        totalFiles: entries.length,
      })
      return complete.data
    } catch (error) {
      try {
        await api.post(
          '/datasets/folder-upload/abort',
          { dataset_name: name },
          { timeout: DATASET_CONTROL_TIMEOUT_MS },
        )
      } catch {
        // Best effort cleanup.
      }
      throw error
    }
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
