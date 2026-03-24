import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle, Trash2, Flag, ChevronRight, ChevronLeft, Download, BarChart3, X, Search, Check } from 'lucide-react'
import { episodesApi, qaApi, tasksApi } from '@/lib/api'
import { Episode, QAProgress } from '@/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dropdown } from '@/components/ui/dropdown'
import { formatDuration, formatNumber } from '@/lib/utils'
import { toast } from 'sonner'

const card = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }
const th: React.CSSProperties = {
  padding: '9px 14px',
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 600,
  color: 'rgba(255,255,255,0.4)',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.07em',
  borderBottom: '1px solid rgba(255,255,255,0.08)',
  background: 'rgba(255,255,255,0.02)',
}
const td: React.CSSProperties = {
  padding: '10px 14px',
  fontSize: 12,
  borderBottom: '1px solid color-mix(in srgb, rgba(255,255,255,0.08) 5%, transparent)',
  color: 'rgba(255,255,255,0.5)',
}

export default function QAPage() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'review' | 'summary'>('review')
  const [reviewIdx, setReviewIdx] = useState(0)
  const [exportName, setExportName] = useState('')
  const [showExport, setShowExport] = useState(false)
  const [exportResult, setExportResult] = useState<{ output_name: string; episodes_exported: number } | null>(null)
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('')
  const [taskFilter, setTaskFilter] = useState('')
  const [reviewSearch, setReviewSearch] = useState('')
  const [selectedEps, setSelectedEps] = useState<Set<number>>(new Set())

  const { data: progress } = useQuery<QAProgress>({ queryKey: ['qa-progress'], queryFn: qaApi.progress, staleTime: 10_000 })
  const { data: unreviewed } = useQuery<{ items: Episode[] }>({
    queryKey: ['unreviewed-eps', reviewSearch],
    queryFn: () => episodesApi.list({ status: 'unreviewed', page_size: 50, task: reviewSearch || undefined }),
    staleTime: 5_000,
  })
  const { data: tasks = [] } = useQuery({ queryKey: ['tasks'], queryFn: tasksApi.list, staleTime: 60_000 })
  const { data: allEps } = useQuery<{ items: Episode[]; total: number; pages: number }>({
    queryKey: ['all-eps-qa', page, statusFilter, taskFilter],
    queryFn: () => episodesApi.list({ page, page_size: 10, status: statusFilter || undefined, task: taskFilter || undefined }),
    staleTime: 15_000,
  })

  const currentEp = unreviewed?.items?.[reviewIdx] ?? null

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => episodesApi.setStatus(id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['unreviewed-eps'] })
      qc.invalidateQueries({ queryKey: ['qa-progress'] })
    },
  })

  const exportMut = useMutation({
    mutationFn: ({ name, ids }: { name: string; ids?: number[] }) => qaApi.export(name, ids),
    onSuccess: (r: any) => {
      toast.success(`Exported ${r.episodes_exported} episodes`)
      setExportResult({ output_name: r.output_name, episodes_exported: r.episodes_exported })
      setSelectedEps(new Set())
      qc.invalidateQueries({ queryKey: ['datasets'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'Export failed'),
  })

  const review = (status: string) => {
    if (!currentEp) return
    statusMut.mutate({ id: currentEp.id, status })
    setReviewIdx((i) => i + 1)
  }

  const next = () => setReviewIdx((i) => Math.min(i + 1, (unreviewed?.items?.length ?? 1) - 1))
  const prev = () => setReviewIdx((i) => Math.max(i - 1, 0))

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT') return
      if (tab !== 'review') return
      switch (e.key.toLowerCase()) {
        case 'v': review('validated'); break
        case 'd': review('deleted'); break
        case 'f': review('flagged'); break
        case 'n': next(); break
        case 'p': prev(); break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, currentEp, reviewIdx])

  const total = progress?.total ?? 0
  const reviewed = progress?.reviewed ?? 0
  const pct = total > 0 ? Math.round((reviewed / total) * 100) : 0

  return (
    <div style={{ padding: 24, maxWidth: 1050 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 17, fontWeight: 700, color: '#fff', margin: 0 }}>QA Review</h1>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', margin: '2px 0 0' }}>{reviewed}/{total} reviewed ({pct}%)</p>
        </div>
        {tab === 'summary' && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {selectedEps.size > 0 && (
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>{selectedEps.size} selected</span>
            )}
            <Button size="sm" variant="outline" onClick={() => setShowExport(true)}>
              <Download style={{ width: 13, height: 13 }} /> {selectedEps.size > 0 ? `Export ${selectedEps.size} Selected` : 'Export Validated'}
            </Button>
          </div>
        )}
      </div>

      {/* Progress bar */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>
          <div style={{ display: 'flex', gap: 16 }}>
            {[['validated', progress?.validated], ['deleted', progress?.deleted], ['flagged', progress?.flagged]].map(([k, v]) => (
              <span key={String(k)}><span style={{ color: '#fff', fontWeight: 600 }}>{v ?? 0}</span> {k}</span>
            ))}
          </div>
          <span>{progress?.unreviewed ?? 0} remaining</span>
        </div>
        <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden' }}>
          <motion.div style={{ height: '100%', background: '#fff', borderRadius: 4 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.6 }} />
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, padding: 3, borderRadius: 9, ...card, width: 'fit-content', marginBottom: 20 }}>
        {(['review', 'summary'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 14px', borderRadius: 7, fontSize: 12, fontWeight: 500, border: 'none', cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s', background: tab === t ? 'rgba(255,255,255,0.1)' : 'transparent', color: tab === t ? '#fff' : 'rgba(255,255,255,0.4)' }}
          >
            {t === 'review'
              ? <><CheckCircle style={{ width: 13, height: 13 }} /> Review</>
              : <><BarChart3 style={{ width: 13, height: 13 }} /> Summary</>
            }
          </button>
        ))}
      </div>

      {/* Review tab */}
      {tab === 'review' && (
        <>
          {/* Search */}
          <div style={{ position: 'relative', marginBottom: 14, maxWidth: 320 }}>
            <Search style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14, color: 'rgba(255,255,255,0.25)', pointerEvents: 'none' }} />
            <input
              placeholder="Search task or episode…"
              value={reviewSearch}
              onChange={(e) => { setReviewSearch(e.target.value); setReviewIdx(0) }}
              style={{ width: '100%', padding: '8px 12px 8px 32px', fontSize: 12, background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 7, color: '#fff', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', transition: 'all 0.15s' }}
              onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.35)')}
              onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)')}
            />
          </div>
          {!currentEp ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 220 }}>
              <CheckCircle style={{ width: 40, height: 40, color: 'rgba(255,255,255,0.25)', marginBottom: 12 }} />
              <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', margin: 0 }}>All episodes reviewed!</p>
            </div>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div key={currentEp.id} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }}
                style={{ borderRadius: 14, padding: 22, ...card, display: 'flex', flexDirection: 'column', gap: 18 }}
              >
                {/* Episode info */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <p style={{ fontFamily: 'monospace', fontSize: 15, fontWeight: 700, color: '#fff', margin: 0 }}>
                      Episode {String(currentEp.episode_index).padStart(6, '0')}
                    </p>
                    <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', margin: '4px 0 0' }}>
                      {currentEp.task_label || 'No task'} · {formatDuration(currentEp.duration)} · {formatNumber(currentEp.frame_count)} frames
                    </p>
                  </div>
                  <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'rgba(255,255,255,0.25)', background: 'rgba(255,255,255,0.06)', padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.08)' }}>
                    {reviewIdx + 1} / {unreviewed?.items?.length ?? 0}
                  </div>
                </div>

                {/* Keyboard shortcuts */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {[['V', 'Validate'], ['D', 'Delete'], ['F', 'Flag'], ['N', 'Next'], ['P', 'Prev']].map(([k, l]) => (
                    <span key={k} style={{ fontSize: 10, fontFamily: 'monospace', padding: '2px 8px', borderRadius: 4, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.5)' }}>
                      {k} {l}
                    </span>
                  ))}
                </div>

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: 10 }}>
                  <Button variant="outline" onClick={() => review('validated')} loading={statusMut.isPending} style={{ flex: 1, justifyContent: 'center' }}>
                    <CheckCircle style={{ width: 14, height: 14 }} /> Validate
                  </Button>
                  <Button variant="secondary" onClick={() => review('flagged')} style={{ flex: 1, justifyContent: 'center' }}>
                    <Flag style={{ width: 14, height: 14 }} /> Flag
                  </Button>
                  <Button variant="destructive" onClick={() => review('deleted')} style={{ flex: 1, justifyContent: 'center' }}>
                    <Trash2 style={{ width: 14, height: 14 }} /> Delete
                  </Button>
                </div>

                {/* Nav */}
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Button size="sm" variant="ghost" onClick={prev} disabled={reviewIdx === 0}>
                    <ChevronLeft style={{ width: 14, height: 14 }} /> Prev
                  </Button>
                  <Button size="sm" variant="ghost" onClick={next}>
                    Skip <ChevronRight style={{ width: 14, height: 14 }} />
                  </Button>
                </div>
              </motion.div>
            </AnimatePresence>
          )}
        </>
      )}

      {/* Summary tab */}
      {tab === 'summary' && (
        <div>
          {/* Filters */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14, padding: '12px 14px', borderRadius: 10, ...card }}>
            <Dropdown
              value={statusFilter}
              placeholder="All Statuses"
              options={[{ value: '', label: 'All Statuses' }, ...['unreviewed', 'validated', 'deleted', 'flagged'].map(s => ({ value: s, label: s }))]}
              onChange={(v) => { setStatusFilter(v); setPage(1) }}
            />
            <Dropdown
              value={taskFilter}
              placeholder="All Tasks"
              options={[{ value: '', label: 'All Tasks' }, ...(tasks as any[]).map((t) => ({ value: t.task, label: t.task }))]}
              onChange={(v) => { setTaskFilter(v); setPage(1) }}
            />
            {(statusFilter || taskFilter) && (
              <Button size="sm" variant="ghost" onClick={() => { setStatusFilter(''); setTaskFilter(''); setPage(1) }}>Clear</Button>
            )}
          </div>
          <div style={{ borderRadius: 12, overflow: 'hidden', ...card }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...th, width: 36, textAlign: 'center', padding: '9px 8px' }}>
                    <button
                      onClick={() => {
                        if (!allEps?.items?.length) return
                        const validatedIds = allEps.items.filter(e => e.status === 'validated').map(e => e.id)
                        if (!validatedIds.length) return
                        const allSelected = validatedIds.every(id => selectedEps.has(id))
                        setSelectedEps(prev => {
                          const next = new Set(prev)
                          validatedIds.forEach(id => allSelected ? next.delete(id) : next.add(id))
                          return next
                        })
                      }}
                      style={{ width: 16, height: 16, borderRadius: 3, border: '1px solid rgba(255,255,255,0.15)', background: (() => { const vIds = allEps?.items?.filter(e => e.status === 'validated').map(e => e.id) ?? []; return vIds.length > 0 && vIds.every(id => selectedEps.has(id)) })() ? '#fff' : 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                    >
                      {(() => { const vIds = allEps?.items?.filter(e => e.status === 'validated').map(e => e.id) ?? []; return vIds.length > 0 && vIds.every(id => selectedEps.has(id)) })() ? <Check style={{ width: 10, height: 10, color: '#000' }} /> : null}
                    </button>
                  </th>
                  {['#', 'Task', 'Duration', 'Frames', 'Status'].map(h => (
                    <th key={h} style={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!allEps?.items?.length ? (
                  <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: 'rgba(255,255,255,0.25)', padding: '40px 0' }}>No episodes</td></tr>
                ) : allEps.items.map((ep) => {
                  const isSelected = selectedEps.has(ep.id)
                  return (
                    <tr key={ep.id}
                      style={{ background: isSelected ? 'rgba(255,255,255,0.06)' : 'transparent', cursor: ep.status === 'validated' ? 'pointer' : 'default', transition: 'background 0.1s' }}
                      onClick={() => { if (ep.status === 'validated') setSelectedEps(prev => { const n = new Set(prev); n.has(ep.id) ? n.delete(ep.id) : n.add(ep.id); return n }) }}
                      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.03)' }}
                      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}
                    >
                      <td style={{ ...td, width: 36, textAlign: 'center', padding: '10px 8px' }}>
                        <div style={{ width: 16, height: 16, borderRadius: 3, border: isSelected ? '1px solid #fff' : ep.status === 'validated' ? '1px solid rgba(255,255,255,0.15)' : '1px solid rgba(255,255,255,0.08)', background: isSelected ? '#fff' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.1s', opacity: ep.status === 'validated' ? 1 : 0.3 }}>
                          {isSelected && <Check style={{ width: 10, height: 10, color: '#000' }} />}
                        </div>
                      </td>
                      <td style={{ ...td, fontFamily: 'monospace', fontWeight: 600, color: '#fff' }}>{String(ep.episode_index).padStart(6, '0')}</td>
                      <td style={{ ...td, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ep.task_label || '—'}</td>
                      <td style={{ ...td, fontFamily: 'monospace' }}>{formatDuration(ep.duration)}</td>
                      <td style={{ ...td, fontFamily: 'monospace' }}>{formatNumber(ep.frame_count)}</td>
                      <td style={td}><Badge variant={ep.status}>{ep.status}</Badge></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>Page {page} of {allEps?.pages ?? 1} · {allEps?.total ?? 0} episodes</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button size="sm" variant="outline" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}><ChevronLeft style={{ width: 14, height: 14 }} /></Button>
              <Button size="sm" variant="outline" onClick={() => setPage(p => p + 1)} disabled={page === (allEps?.pages ?? 1)}><ChevronRight style={{ width: 14, height: 14 }} /></Button>
            </div>
          </div>
        </div>
      )}

      {/* Export modal */}
      <AnimatePresence>
        {showExport && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => { setShowExport(false); setExportResult(null) }}
            style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(10px)' }}
          >
            <motion.div initial={{ scale: 0.94, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.94 }}
              onClick={(e) => e.stopPropagation()}
              style={{ width: '100%', maxWidth: 380, margin: '0 16px', borderRadius: 14, padding: 28, background: '#0c0c0c', border: '1px solid rgba(255,255,255,0.08)', position: 'relative' }}
            >
              <button onClick={() => { setShowExport(false); setExportResult(null) }} style={{ position: 'absolute', top: 12, right: 12, background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', padding: 4, display: 'flex' }}>
                <X style={{ width: 14, height: 14 }} />
              </button>

              {exportResult ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <CheckCircle style={{ width: 18, height: 18, color: '#4ade80' }} />
                    <h2 style={{ fontSize: 15, fontWeight: 700, color: '#fff', margin: 0 }}>Export Complete</h2>
                  </div>
                  <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', margin: '0 0 20px', lineHeight: 1.5 }}>
                    {exportResult.episodes_exported} episodes exported as <span style={{ color: '#fff', fontWeight: 600 }}>"{exportResult.output_name}"</span>.
                    Download the dataset as a zip file to access it on your PC.
                  </p>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <Button variant="ghost" onClick={() => { setShowExport(false); setExportResult(null) }}>Close</Button>
                    <a href={qaApi.downloadUrl(exportResult.output_name)} download style={{ textDecoration: 'none' }}>
                      <Button>
                        <Download style={{ width: 13, height: 13 }} /> Download .zip
                      </Button>
                    </a>
                  </div>
                </>
              ) : (
                <>
                  <h2 style={{ fontSize: 15, fontWeight: 700, color: '#fff', margin: '0 0 6px' }}>
                    {selectedEps.size > 0 ? `Export ${selectedEps.size} Selected Episodes` : 'Export Validated Episodes'}
                  </h2>
                  <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', margin: '0 0 20px', lineHeight: 1.5 }}>
                    {selectedEps.size > 0
                      ? `${selectedEps.size} selected validated episode${selectedEps.size !== 1 ? 's' : ''} will be exported as a new LeRobot v2.1 dataset.`
                      : `${progress?.validated ?? 0} validated episodes will be exported as a new LeRobot v2.1 dataset.`
                    }
                  </p>
                  <div style={{ marginBottom: 20 }}>
                    <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', display: 'block', marginBottom: 6 }}>Output dataset name</label>
                    <input
                      value={exportName} onChange={(e) => setExportName(e.target.value)}
                      placeholder="validated_export_v1" autoFocus
                      style={{ width: '100%', padding: '9px 12px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)', color: '#fff', fontSize: 13, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
                      onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.35)')}
                      onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)')}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <Button variant="ghost" onClick={() => setShowExport(false)}>Cancel</Button>
                    <Button onClick={() => { if (exportName) exportMut.mutate({ name: exportName, ids: selectedEps.size > 0 ? [...selectedEps] : undefined }) }} loading={exportMut.isPending}>
                      <Download style={{ width: 13, height: 13 }} /> Export
                    </Button>
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
