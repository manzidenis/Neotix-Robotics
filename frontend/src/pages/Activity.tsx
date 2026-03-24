import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Activity, ChevronLeft, ChevronRight } from 'lucide-react'
import { activityApi } from '@/lib/api'
import { ActivityItem } from '@/types'
import { Button } from '@/components/ui/button'
import { Dropdown } from '@/components/ui/dropdown'
import { relativeTime } from '@/lib/utils'

const ACTION_LABELS: Record<string, string> = {
  login:            'login',
  register:         'register',
  status_change:    'status',
  task_rename:      'rename',
  export:           'export',
  merge_datasets:   'merge',
  activate_dataset: 'activate',
  import_dataset:   'import',
  upload_dataset:   'upload',
  replay_start:     'replay',
}

export default function ActivityPage() {
  const [page, setPage] = useState(1)
  const [userFilter, setUserFilter] = useState('')
  const [actionFilter, setActionFilter] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['activity', page, userFilter, actionFilter],
    queryFn: () => activityApi.list({ page, page_size: 8, user: userFilter || undefined, action: actionFilter || undefined }),
    staleTime: 30_000,
    refetchInterval: 30_000,
  })

  const items: ActivityItem[] = data?.items ?? []
  const pages: number = data?.pages ?? 1

  const inp: React.CSSProperties = { fontSize: 12, background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, padding: '5px 10px', color: '#fff', outline: 'none', fontFamily: 'inherit', width: 160, transition: 'all 0.15s' }

  return (
    <div style={{ padding: 24, maxWidth: 900 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <Activity style={{ width: 18, height: 18, color: 'rgba(255,255,255,0.5)' }} />
        <div>
          <h1 style={{ fontSize: 17, fontWeight: 700, color: '#fff', margin: 0 }}>Activity Feed</h1>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', margin: '2px 0 0' }}>{data?.total ?? 0} total actions</p>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16, padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <input placeholder="Filter by user…" value={userFilter} onChange={(e) => { setUserFilter(e.target.value); setPage(1) }} style={inp}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.35)'; e.currentTarget.style.background = 'rgba(255,255,255,0.06)' }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'; e.currentTarget.style.background = 'transparent' }} />
        <Dropdown
          value={actionFilter}
          placeholder="All Actions"
          options={[{ value: '', label: 'All Actions' }, ...Object.keys(ACTION_LABELS).map(a => ({ value: a, label: a }))]}
          onChange={(v) => { setActionFilter(v); setPage(1) }}
        />
        {(userFilter || actionFilter) && (
          <Button size="sm" variant="ghost" onClick={() => { setUserFilter(''); setActionFilter(''); setPage(1) }}>Clear</Button>
        )}
      </div>

      {/* Activity list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {isLoading ? (
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 60, borderRadius: 10 }} />
          ))
        ) : items.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 180 }}>
            <Activity style={{ width: 32, height: 32, color: 'rgba(255,255,255,0.15)', marginBottom: 10 }} />
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.25)', margin: 0 }}>No activity yet</p>
          </div>
        ) : items.map((item) => (
          <div key={item.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)')}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)')}
          >
            {/* Avatar */}
            <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
              {item.username?.[0]?.toUpperCase()}
            </div>
            {/* Content */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 2 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{item.username}</span>
                <span style={{ fontSize: 10, fontFamily: 'monospace', padding: '1px 7px', borderRadius: 4, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.14)', color: 'rgba(255,255,255,0.5)' }}>
                  {ACTION_LABELS[item.action] ?? item.action}
                </span>
                {item.dataset_id && (
                  <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'rgba(255,255,255,0.25)' }}>ds:{item.dataset_id}</span>
                )}
              </div>
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.details}</p>
            </div>
            {/* Time */}
            <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'rgba(255,255,255,0.25)', flexShrink: 0, marginTop: 2 }}>{relativeTime(item.created_at)}</span>
          </div>
        ))}
      </div>

      {/* Pagination */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>Page {page} of {pages} · {data?.total ?? 0} actions</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button size="sm" variant="outline" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}><ChevronLeft style={{ width: 14, height: 14 }} /></Button>
          <Button size="sm" variant="outline" onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page === pages}><ChevronRight style={{ width: 14, height: 14 }} /></Button>
        </div>
      </div>
    </div>
  )
}
