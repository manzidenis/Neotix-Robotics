import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { Database, Upload, FolderOpen, Merge, Zap, Trash2, Edit2, Check, X, CloudDownload, ChevronLeft, ChevronRight, Search, Download } from 'lucide-react' // eslint-disable-line
import { datasetsApi, qaApi } from '@/lib/api'
import { useAppStore } from '@/store'
import { Dataset } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Dropdown } from '@/components/ui/dropdown'
import { formatNumber } from '@/lib/utils'
import { toast } from 'sonner'

const card = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }

export default function DatasetsPage() {
  const qc = useQueryClient()
  const { setActiveDataset } = useAppStore()

  const { data: datasets = [], isLoading } = useQuery({ queryKey: ['datasets'], queryFn: datasetsApi.list, staleTime: 30_000 })

const activateMut = useMutation({
    mutationFn: (id: number) => datasetsApi.activate(id),
    onSuccess: (ds) => {
      setActiveDataset(ds.id, ds.name, ds.robot_type)
      qc.invalidateQueries()
      toast.success(`"${ds.name}" is now active`)
    },
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => datasetsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['datasets'] })
      qc.invalidateQueries({ queryKey: ['datasets-scan'] })
      toast.success('Dataset deleted')
    },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Delete failed'),
  })

  const renameMut = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => datasetsApi.rename(id, name),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['datasets'] }); toast.success('Renamed') },
  })

  const mergeMut = useMutation({
    mutationFn: ({ ids, name }: { ids: number[]; name: string }) => datasetsApi.merge(ids, name),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['datasets'] }); toast.success(`Merged → ${r.total_episodes} episodes`) },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Merge failed'),
  })

  const folderUploadMut = useMutation({
    mutationFn: ({ files, name }: { files: File[]; name: string }) => datasetsApi.uploadFolder(files, name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['datasets'] })
      setFolderSelection(null)
      if (folderInputRef.current) folderInputRef.current.value = ''
      toast.success('Dataset folder uploaded')
    },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Folder upload failed'),
  })

  const uploadMut = useMutation({
    mutationFn: ({ file, name }: { file: File; name: string }) => datasetsApi.upload(file, name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['datasets'] })
      setShowUpload(false)
      setUploadFile(null)
      toast.success('Dataset uploaded')
    },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Upload failed'),
  })

  const [dsPage, setDsPage] = useState(1)
  const DS_PAGE_SIZE = 6
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [mergeName, setMergeName] = useState('')
  const [showUpload, setShowUpload] = useState(false)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [folderSelection, setFolderSelection] = useState<{ name: string; files: File[] } | null>(null)
  const [sourceFilter, setSourceFilter] = useState('')
  const [nameSearch, setNameSearch] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  const [showMergeWizard, setShowMergeWizard] = useState(false)
  const [mergeCheck, setMergeCheck] = useState<{ compatible: boolean; errors: string[]; datasets: any[]; merged_tasks: any[] } | null>(null)
  const [mergeChecking, setMergeChecking] = useState(false)

  useEffect(() => {
    const input = folderInputRef.current
    if (!input) return
    input.setAttribute('webkitdirectory', '')
    input.setAttribute('directory', '')
  }, [])

  const toggleSelect = (id: number) =>
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const openMergeWizard = async () => {
    setMergeChecking(true)
    setShowMergeWizard(true)
    setMergeCheck(null)
    try {
      const result = await datasetsApi.mergeCheck([...selected])
      setMergeCheck(result)
    } catch (e: any) {
      setMergeCheck({ compatible: false, errors: [e.response?.data?.detail || 'Check failed'], datasets: [], merged_tasks: [] })
    } finally {
      setMergeChecking(false)
    }
  }

  const confirmDelete = (ds: Dataset) => {
    if (ds.is_active) { toast.error("Can't delete the active dataset"); return }
    if (confirm(`Delete "${ds.name}"? This cannot be undone.`)) deleteMut.mutate(ds.id)
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null
    setUploadFile(f)
    if (f) setShowUpload(true)
  }

  const handleFolderFiles = (fileList: FileList | null) => {
    if (!fileList?.length) return
    const files = Array.from(fileList)
    const firstRelativePath = (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath || files[0].name
    const name = firstRelativePath.split('/')[0] || files[0].name
    setFolderSelection({ name, files })
    if (folderInputRef.current) folderInputRef.current.value = ''
  }

  const autoName = uploadFile ? uploadFile.name.replace(/\.zip$/i, '') : ''

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: '#fff', margin: 0 }}>Datasets</h1>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', margin: '4px 0 0' }}>
            {datasets.length} registered dataset{datasets.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {selected.size >= 2 && (
            <Button size="sm" variant="outline" onClick={openMergeWizard}>
              <Merge className="w-3.5 h-3.5" /> Merge {selected.size} Datasets
            </Button>
          )}
          <input ref={folderInputRef} type="file" multiple style={{ display: 'none' }} onChange={(e) => handleFolderFiles(e.target.files)} />
          <Button size="sm" variant="secondary" onClick={() => folderInputRef.current?.click()}>
            <FolderOpen className="w-3.5 h-3.5" /> Import Folder
          </Button>
          {/* Hidden zip picker */}
          <input ref={fileInputRef} type="file" accept=".zip" style={{ display: 'none' }} onChange={handleFileSelect} />
          <Button size="sm" variant="secondary" onClick={() => fileInputRef.current?.click()}>
            <Upload className="w-3.5 h-3.5" /> Upload ZIP
          </Button>
        </div>
      </div>

      {/* Import confirmation panel */}
      <AnimatePresence>
        {folderSelection && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} style={{ overflow: 'hidden', marginBottom: 18 }}>
            <div style={{ borderRadius: 14, padding: '20px 22px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', position: 'relative' }}>
              <button onClick={() => setFolderSelection(null)} style={{ position: 'absolute', top: 10, right: 10, background: 'none', border: 'none', color: 'rgba(255,255,255,0.25)', cursor: 'pointer', padding: 4, display: 'flex', borderRadius: 4, transition: 'color 0.15s' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#fff')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.25)')}>
                <X style={{ width: 13, height: 13 }} />
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <FolderOpen style={{ width: 17, height: 17, color: '#fff' }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: '#fff', margin: 0 }}>{folderSelection.name}</p>
                  <p style={{ fontSize: 10, fontFamily: 'monospace', color: 'rgba(255,255,255,0.35)', margin: '4px 0 0', padding: '3px 8px', background: 'rgba(255,255,255,0.04)', borderRadius: 4, display: 'inline-block' }}>
                    {folderSelection.files.length} files ready for upload
                  </p>
                </div>
                <Button size="sm" onClick={() => folderUploadMut.mutate({ files: folderSelection.files, name: folderSelection.name })} loading={folderUploadMut.isPending}>
                  <CloudDownload className="w-3.5 h-3.5" /> Upload
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Upload confirmation panel */}
      <AnimatePresence>
        {showUpload && uploadFile && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} style={{ overflow: 'hidden', marginBottom: 18 }}>
            <div style={{ borderRadius: 14, padding: '20px 22px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', position: 'relative' }}>
              <button
                onClick={() => { setUploadFile(null); setShowUpload(false); if (fileInputRef.current) fileInputRef.current.value = '' }}
                style={{ position: 'absolute', top: 10, right: 10, background: 'none', border: 'none', color: 'rgba(255,255,255,0.25)', cursor: 'pointer', padding: 4, display: 'flex', borderRadius: 4, transition: 'color 0.15s' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#fff')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.25)')}>
                <X style={{ width: 13, height: 13 }} />
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Upload style={{ width: 17, height: 17, color: '#fff' }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: '#fff', margin: 0 }}>{uploadFile.name}</p>
                  <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', margin: '4px 0 0' }}>
                    {(uploadFile.size / 1024 / 1024).toFixed(1)} MB · imports as <span style={{ color: 'rgba(255,255,255,0.6)', fontWeight: 500 }}>{autoName}</span>
                  </p>
                </div>
                <Button size="sm" onClick={() => uploadMut.mutate({ file: uploadFile, name: autoName })} loading={uploadMut.isPending}>
                  <Upload className="w-3.5 h-3.5" /> Upload
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16, padding: '10px 14px', borderRadius: 10, ...card, alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: 280 }}>
          <Search style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14, color: 'rgba(255,255,255,0.25)', pointerEvents: 'none' }} />
          <input
            placeholder="Search dataset name…"
            value={nameSearch}
            onChange={(e) => { setNameSearch(e.target.value); setDsPage(1) }}
            style={{ width: '100%', padding: '8px 12px 8px 32px', fontSize: 12, background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 7, color: '#fff', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', transition: 'all 0.15s' }}
            onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.35)')}
            onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)')}
          />
        </div>
        <Dropdown
          value={sourceFilter}
          placeholder="All Sources"
          options={[
            { value: '', label: 'All Sources' },
            { value: 'original', label: 'Imported' },
            { value: 'export', label: 'Exported' },
            { value: 'merge', label: 'Merged' },
          ]}
          onChange={(v) => { setSourceFilter(v); setDsPage(1) }}
        />
        {(sourceFilter || nameSearch) && (
          <Button size="sm" variant="ghost" onClick={() => { setSourceFilter(''); setNameSearch(''); setDsPage(1) }}>Clear</Button>
        )}
      </div>

      {/* Dataset grid */}
      {isLoading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 14 }}>
          {[1, 2, 3].map((i) => <div key={i} className="h-48 skeleton rounded-xl" />)}
        </div>
      ) : datasets.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 220, color: 'rgba(255,255,255,0.25)' }}>
          <Database style={{ width: 40, height: 40, marginBottom: 12, opacity: 0.25 }} />
          <p style={{ fontSize: 13, margin: 0 }}>No datasets yet. Import or upload one to get started.</p>
        </div>
      ) : (() => {
        const allDs = (datasets as Dataset[]).filter((ds) => {
          if (sourceFilter && (ds.source || 'original') !== sourceFilter) return false
          if (nameSearch && !ds.name.toLowerCase().includes(nameSearch.toLowerCase())) return false
          return true
        })
        const dsPages = Math.max(1, Math.ceil(allDs.length / DS_PAGE_SIZE))
        const paged = allDs.slice((dsPage - 1) * DS_PAGE_SIZE, dsPage * DS_PAGE_SIZE)
        return (<>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 14 }}>
          {paged.map((ds) => (
            <div
              key={ds.id}
              style={{
                position: 'relative', borderRadius: 14, padding: 20, cursor: 'pointer', transition: 'border-color 0.15s, background 0.15s',
                background: ds.is_active ? 'rgba(255,255,255,0.06)' : selected.has(ds.id) ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)',
                border: ds.is_active ? '1px solid rgba(255,255,255,0.15)' : selected.has(ds.id) ? '1px solid rgba(255,255,255,0.15)' : '1px solid rgba(255,255,255,0.08)',
              }}
              onClick={() => toggleSelect(ds.id)}
            >
              {selected.has(ds.id) && (
                <div style={{ position: 'absolute', top: 12, right: 12 }}>
                  <Check style={{ width: 14, height: 14, color: '#fff' }} />
                </div>
              )}

              {/* Header */}
              <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'flex-start' }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Database style={{ width: 15, height: 15, color: '#fff' }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {editingId === ds.id ? (
                    <div style={{ display: 'flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>
                      <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-7 text-xs flex-1" autoFocus />
                      <button onClick={() => { renameMut.mutate({ id: ds.id, name: editName }); setEditingId(null) }} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}><Check style={{ width: 14, height: 14 }} /></button>
                      <button onClick={() => setEditingId(null)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer' }}><X style={{ width: 14, height: 14 }} /></button>
                    </div>
                  ) : (
                    <p style={{ fontSize: 14, fontWeight: 600, color: '#fff', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ds.name}</p>
                  )}
                  <div style={{ display: 'flex', gap: 5, marginTop: 6, flexWrap: 'wrap' }}>
                    <Badge variant={ds.robot_type}>{ds.robot_type}</Badge>
                    {ds.is_active && <Badge variant="active">ACTIVE</Badge>}
                    <Badge variant={
                      (ds.source || 'original') === 'export' ? 'exported'
                        : (ds.source || 'original') === 'merge' ? 'merged'
                        : 'imported'
                    }>
                      {(ds.source || 'original') === 'export' ? 'EXPORTED'
                        : (ds.source || 'original') === 'merge' ? 'MERGED'
                        : 'IMPORTED'}
                    </Badge>
                  </div>
                </div>
              </div>

              {/* Stats */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 7, marginBottom: 14 }}>
                {[
                  { label: 'Episodes', value: formatNumber(ds.total_episodes) },
                  { label: 'Frames',   value: formatNumber(ds.total_frames) },
                  { label: 'FPS',      value: String(ds.fps) },
                ].map(({ label, value }) => (
                  <div key={label} style={{ textAlign: 'center', padding: '6px 4px', borderRadius: 7, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                    <p style={{ fontSize: 12, fontWeight: 700, color: '#fff', margin: 0 }}>{value}</p>
                    <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', margin: '2px 0 0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</p>
                  </div>
                ))}
              </div>

              {/* Cameras */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 14 }}>
                {(ds.cameras || []).map((c) => (
                  <span key={c} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.5)', fontFamily: 'monospace' }}>{c}</span>
                ))}
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 7 }} onClick={(e) => e.stopPropagation()}>
                {!ds.is_active && (
                  <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => activateMut.mutate(ds.id)} loading={activateMut.isPending}>
                    <Zap className="w-3 h-3" /> Activate
                  </Button>
                )}
                <Button size="icon-sm" variant="ghost" onClick={() => { setEditingId(ds.id); setEditName(ds.name) }}><Edit2 className="w-3.5 h-3.5" /></Button>
                {((ds.source || 'original') === 'export' || (ds.source || 'original') === 'merge') && (
                  <a href={qaApi.downloadUrl(ds.name)} download onClick={(e) => e.stopPropagation()} style={{ display: 'flex' }}>
                    <Button size="icon-sm" variant="ghost"><Download className="w-3.5 h-3.5" /></Button>
                  </a>
                )}
                <Button size="icon-sm" variant="ghost" onClick={() => confirmDelete(ds)} disabled={ds.is_active}><Trash2 className="w-3.5 h-3.5" /></Button>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>Page {dsPage} of {dsPages} · {allDs.length} datasets</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button size="sm" variant="outline" onClick={() => setDsPage(p => Math.max(1, p - 1))} disabled={dsPage === 1}><ChevronLeft style={{ width: 14, height: 14 }} /></Button>
            <Button size="sm" variant="outline" onClick={() => setDsPage(p => Math.min(dsPages, p + 1))} disabled={dsPage === dsPages}><ChevronRight style={{ width: 14, height: 14 }} /></Button>
          </div>
        </div>
        </>)
      })()}

      {/* Merge Wizard Modal */}
      <AnimatePresence>
        {showMergeWizard && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => { setShowMergeWizard(false); setMergeCheck(null); setMergeName('') }}
            style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(10px)' }}
          >
            <motion.div initial={{ scale: 0.94, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.94 }}
              onClick={(e) => e.stopPropagation()}
              style={{ width: '100%', maxWidth: 480, margin: '0 16px', borderRadius: 14, padding: 28, background: '#0c0c0c', border: '1px solid rgba(255,255,255,0.08)', position: 'relative', maxHeight: '80vh', overflowY: 'auto' }}
            >
              <button onClick={() => { setShowMergeWizard(false); setMergeCheck(null); setMergeName('') }} style={{ position: 'absolute', top: 12, right: 12, background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', padding: 4, display: 'flex' }}>
                <X style={{ width: 14, height: 14 }} />
              </button>

              <h2 style={{ fontSize: 15, fontWeight: 700, color: '#fff', margin: '0 0 6px' }}>Merge Datasets</h2>
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', margin: '0 0 18px' }}>Compatibility check and task mapping preview</p>

              {mergeChecking ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 20, justifyContent: 'center' }}>
                  <div style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.15)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>Checking compatibility...</span>
                </div>
              ) : mergeCheck ? (
                <>
                  {/* Compatibility result */}
                  <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 14, background: mergeCheck.compatible ? 'rgba(74,222,128,0.08)' : 'rgba(239,68,68,0.08)', border: `1px solid ${mergeCheck.compatible ? 'rgba(74,222,128,0.2)' : 'rgba(239,68,68,0.2)'}` }}>
                    <p style={{ fontSize: 12, fontWeight: 600, color: mergeCheck.compatible ? '#4ade80' : '#f87171', margin: 0 }}>
                      {mergeCheck.compatible ? 'Datasets are compatible' : 'Incompatible datasets'}
                    </p>
                    {mergeCheck.errors.length > 0 && (
                      <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 11, color: 'rgba(239,68,68,0.8)' }}>
                        {mergeCheck.errors.map((e, i) => <li key={i}>{e}</li>)}
                      </ul>
                    )}
                  </div>

                  {/* Datasets summary */}
                  <div style={{ marginBottom: 14 }}>
                    <p style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 6px' }}>Datasets</p>
                    {mergeCheck.datasets.map((ds: any) => (
                      <div key={ds.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', borderRadius: 6, marginBottom: 4, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', fontSize: 12 }}>
                        <span style={{ color: '#fff', fontWeight: 500 }}>{ds.name}</span>
                        <span style={{ color: 'rgba(255,255,255,0.4)' }}>{ds.episodes} eps · {ds.fps} fps · {ds.robot_type}</span>
                      </div>
                    ))}
                  </div>

                  {/* Task mapping preview */}
                  {mergeCheck.merged_tasks.length > 0 && (
                    <div style={{ marginBottom: 18 }}>
                      <p style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 6px' }}>Merged Task Mapping</p>
                      <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr>
                              <th style={{ padding: '6px 10px', fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.4)', textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}>Index</th>
                              <th style={{ padding: '6px 10px', fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.4)', textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}>Task</th>
                              <th style={{ padding: '6px 10px', fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.4)', textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}>Source</th>
                            </tr>
                          </thead>
                          <tbody>
                            {mergeCheck.merged_tasks.map((t: any) => (
                              <tr key={t.task_index}>
                                <td style={{ padding: '5px 10px', fontSize: 11, fontFamily: 'monospace', color: 'rgba(255,255,255,0.5)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>{t.task_index}</td>
                                <td style={{ padding: '5px 10px', fontSize: 11, color: '#fff', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>{t.task}</td>
                                <td style={{ padding: '5px 10px', fontSize: 11, color: 'rgba(255,255,255,0.4)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>{t.source}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Merge controls */}
                  {mergeCheck.compatible && (
                    <div>
                      <div style={{ marginBottom: 14 }}>
                        <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', display: 'block', marginBottom: 6 }}>Output dataset name</label>
                        <input
                          value={mergeName} onChange={(e) => setMergeName(e.target.value)}
                          placeholder="merged_dataset" autoFocus
                          style={{ width: '100%', padding: '9px 12px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)', color: '#fff', fontSize: 13, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
                          onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.35)')}
                          onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)')}
                        />
                      </div>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <Button variant="ghost" onClick={() => { setShowMergeWizard(false); setMergeCheck(null); setMergeName('') }}>Cancel</Button>
                        <Button
                          onClick={() => { if (mergeName) { mergeMut.mutate({ ids: [...selected], name: mergeName }); setSelected(new Set()); setMergeName(''); setShowMergeWizard(false); setMergeCheck(null) } }}
                          loading={mergeMut.isPending}
                          disabled={!mergeName}
                        >
                          <Merge className="w-3.5 h-3.5" /> Merge
                        </Button>
                      </div>
                    </div>
                  )}

                  {!mergeCheck.compatible && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <Button variant="ghost" onClick={() => { setShowMergeWizard(false); setMergeCheck(null) }}>Close</Button>
                    </div>
                  )}
                </>
              ) : null}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  )
}
