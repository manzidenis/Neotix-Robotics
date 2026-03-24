import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Film, ChevronLeft, ChevronRight, ArrowUpDown, Search } from 'lucide-react'
import { episodesApi, tasksApi } from '@/lib/api'
import { Episode } from '@/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dropdown } from '@/components/ui/dropdown'
import { formatDuration, formatNumber } from '@/lib/utils'

const card = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }
const th: React.CSSProperties = { padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase' as const, letterSpacing: '0.07em', borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)', userSelect: 'none' as const }
const td: React.CSSProperties = { padding: '11px 16px', fontSize: 13, borderBottom: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.5)' }

export default function EpisodesPage() {
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('')
  const [taskFilter, setTaskFilter] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [sort, setSort] = useState('episode_index')
  const [order, setOrder] = useState('asc')

  const activeTask = searchTerm || taskFilter || undefined

  const { data, isLoading } = useQuery({
    queryKey: ['episodes', page, statusFilter, taskFilter, searchTerm, sort, order],
    queryFn: () => episodesApi.list({ page, page_size: 10, status: statusFilter || undefined, task: activeTask, sort, order }),
    staleTime: 10_000,
  })

  const { data: tasks = [] } = useQuery({ queryKey: ['tasks'], queryFn: tasksApi.list, staleTime: 60_000 })

  const episodes: Episode[] = data?.items ?? []
  const total: number = data?.total ?? 0
  const pages: number = data?.pages ?? 1

  const toggleSort = (col: string) => {
    if (sort === col) setOrder(o => o === 'asc' ? 'desc' : 'asc')
    else { setSort(col); setOrder('asc') }
    setPage(1)
  }

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Film style={{ width: 18, height: 18, color: 'rgba(255,255,255,0.5)' }} />
          <div>
            <h1 style={{ fontSize: 17, fontWeight: 700, color: '#fff', margin: 0 }}>Episodes</h1>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', margin: '2px 0 0' }}>{formatNumber(total)} total</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16, padding: '12px 14px', borderRadius: 10, ...card, alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: 260 }}>
          <Search style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14, color: 'rgba(255,255,255,0.25)', pointerEvents: 'none' }} />
          <input
            placeholder="Search task or episode…"
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setPage(1) }}
            style={{ width: '100%', padding: '8px 12px 8px 32px', fontSize: 12, background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 7, color: '#fff', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', transition: 'all 0.15s' }}
            onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.35)')}
            onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)')}
          />
        </div>
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
        {(statusFilter || taskFilter || searchTerm) && (
          <Button size="sm" variant="ghost" onClick={() => { setStatusFilter(''); setTaskFilter(''); setSearchTerm(''); setPage(1) }}>Clear</Button>
        )}
      </div>

      {/* Table */}
      <div style={{ borderRadius: 12, overflow: 'hidden', ...card }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {[
                { label: '#', col: 'episode_index' },
                { label: 'Task', col: null },
                { label: 'Duration', col: 'duration' },
                { label: 'Frames', col: 'frame_count' },
                { label: 'Status', col: null },
              ].map(({ label, col }) => (
                <th key={label} style={{ ...th, cursor: col ? 'pointer' : 'default' }} onClick={() => col && toggleSort(col)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {label}
                    {col && <ArrowUpDown style={{ width: 11, height: 11, opacity: sort === col ? 0.8 : 0.3 }} />}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 10 }).map((_, i) => (
                <tr key={i}>
                  {[1, 2, 3, 4, 5].map(j => (
                    <td key={j} style={td}><div className="skeleton" style={{ height: 14, borderRadius: 4 }} /></td>
                  ))}
                </tr>
              ))
            ) : episodes.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: '48px 16px', textAlign: 'center' }}>
                  <Film style={{ width: 32, height: 32, color: 'rgba(255,255,255,0.15)', margin: '0 auto 10px' }} />
                  <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.25)', margin: 0 }}>No episodes found</p>
                </td>
              </tr>
            ) : episodes.map((ep) => (
              <tr
                key={ep.id}
                onClick={() => navigate(`/app/episodes/${ep.id}`)}
                style={{ cursor: 'pointer', transition: 'background 0.12s' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <td style={{ ...td, fontFamily: 'monospace', color: '#fff', fontWeight: 600 }}>
                  {String(ep.episode_index).padStart(6, '0')}
                </td>
                <td style={{ ...td, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {ep.task_label || <span style={{ color: 'rgba(255,255,255,0.25)' }}>—</span>}
                </td>
                <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>{formatDuration(ep.duration)}</td>
                <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>{formatNumber(ep.frame_count)}</td>
                <td style={td}><Badge variant={ep.status}>{ep.status}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>Page {page} of {pages} · {formatNumber(total)} episodes</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button size="sm" variant="outline" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}><ChevronLeft style={{ width: 14, height: 14 }} /></Button>
            <Button size="sm" variant="outline" onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page === pages}><ChevronRight style={{ width: 14, height: 14 }} /></Button>
          </div>
        </div>
      )}
    </div>
  )
}
