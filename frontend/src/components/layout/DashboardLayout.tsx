import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Database, Film, CheckSquare, Play, Activity, LogOut, Cpu, Menu, X } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useAuthStore, useAppStore } from '@/store'
import { queryClient } from '@/queryClient'
import { datasetsApi } from '@/lib/api'

const NAV = [
  { to: '/app/datasets',  icon: Database,    label: 'Datasets' },
  { to: '/app/episodes',  icon: Film,        label: 'Episodes' },
  { to: '/app/qa',        icon: CheckSquare, label: 'QA Review' },
  { to: '/app/simulator', icon: Play,        label: 'Simulator' },
  { to: '/app/activity',  icon: Activity,    label: 'Activity' },
]

export default function DashboardLayout() {
  const { user, logout } = useAuthStore()
  const { activeDatasetName, setActiveDataset } = useAppStore()
  const navigate  = useNavigate()
  const location  = useLocation()
  const [open, setOpen] = useState(true)
  const [showLogout, setShowLogout] = useState(false)

  useEffect(() => {
    if (!activeDatasetName) {
      datasetsApi.list().then((datasets: any[]) => {
        const active = datasets.find((ds: any) => ds.is_active)
        if (active) setActiveDataset(active.id, active.name, active.robot_type)
      }).catch(() => {})
    }
  }, [activeDatasetName, setActiveDataset])

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#000' }}>
      {/* Sidebar */}
      <motion.aside
        animate={{ width: open ? 240 : 52 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="flex-shrink-0 flex flex-col border-r z-20"
        style={{ borderColor: 'rgba(255,255,255,0.08)', background: '#0a0a0a' }}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-3 py-4 border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
          <div className="w-8 h-8 rounded-lg border flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.15)' }}>
            <Cpu className="w-4 h-4 text-white" />
          </div>
          <AnimatePresence>
            {open && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 min-w-0">
                <p className="text-xs font-bold tracking-[0.15em] text-white">NEOTIX</p>
                <p className="text-[10px]" style={{ color: 'rgba(255,255,255,0.25)' }}>Robotics Platform</p>
              </motion.div>
            )}
          </AnimatePresence>
          <button
            onClick={() => setOpen(!open)}
            className="flex-shrink-0 ml-auto transition-colors"
            style={{ color: 'rgba(255,255,255,0.25)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#fff')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.25)')}
          >
            {open ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
        </div>

        {/* Active dataset chip */}
        <AnimatePresence>
          {open && activeDatasetName && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mx-3 mt-2 px-2.5 py-2 rounded overflow-hidden"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              <p className="text-[10px] uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.25)' }}>Active Dataset</p>
              <p className="text-xs font-medium truncate mt-0.5 text-white">{activeDatasetName}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Navigation */}
        <nav className="flex-1 p-2 space-y-0.5 mt-2 overflow-hidden">
          {NAV.map(({ to, icon: Icon, label }) => {
            const active = location.pathname.startsWith(to)
            return (
              <NavLink
                key={to}
                to={to}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '7px 10px',
                  borderRadius: '6px',
                  fontSize: '13px',
                  transition: 'all 0.15s',
                  background: active ? 'rgba(255,255,255,0.1)' : 'transparent',
                  color: active ? '#fff' : 'rgba(255,255,255,0.4)',
                  border: active ? '1px solid rgba(255,255,255,0.15)' : '1px solid transparent',
                  textDecoration: 'none',
                }}
              >
                <Icon style={{ width: 16, height: 16, flexShrink: 0 }} />
                <AnimatePresence>
                  {open && (
                    <motion.span
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      style={{ fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap' }}
                    >
                      {label}
                    </motion.span>
                  )}
                </AnimatePresence>
              </NavLink>
            )
          })}
        </nav>

        {/* User footer */}
        <div className="p-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
          <div className="flex items-center gap-2.5">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
              style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)' }}
            >
              {user?.username?.[0]?.toUpperCase()}
            </div>
            <AnimatePresence>
              {open && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 min-w-0">
                  <p className="text-xs truncate font-medium text-white">{user?.username}</p>
                  <p className="text-[10px] truncate" style={{ color: 'rgba(255,255,255,0.25)' }}>{user?.email}</p>
                </motion.div>
              )}
            </AnimatePresence>
            <div className="relative group">
              <button
                onClick={() => setShowLogout(true)}
                className="flex-shrink-0 transition-colors"
                style={{ color: 'rgba(255,255,255,0.25)' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#fff')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.25)')}
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
              <span className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap text-[10px] font-medium px-2 py-1 rounded-md"
                style={{ background: '#1a1a1a', color: '#fff', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
                Sign out
              </span>
            </div>
          </div>
        </div>
      </motion.aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto" style={{ background: '#000' }}>
        <Outlet />
      </main>

      {/* Sign-out confirmation */}
      <AnimatePresence>
        {showLogout && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setShowLogout(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)' }}
          >
            <motion.div
              initial={{ scale: 0.94, y: 12, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.94, y: 12, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              onClick={(e) => e.stopPropagation()}
              style={{ width: '100%', maxWidth: 320, margin: '0 16px', borderRadius: 14, border: '1px solid rgba(255,255,255,0.15)', padding: '28px 28px 24px', background: '#0c0c0c', textAlign: 'center' }}
            >
              <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                <LogOut style={{ width: 18, height: 18, color: '#fff' }} />
              </div>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#fff', margin: '0 0 6px' }}>Sign out?</h3>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', margin: '0 0 24px', lineHeight: 1.5 }}>
                Are you sure you want to sign out of your account?
              </p>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={() => setShowLogout(false)}
                  style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', transition: 'background 0.15s' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  Cancel
                </button>
                <button
                  onClick={() => { queryClient.clear(); useAppStore.getState().setActiveDataset(null, null); logout(); navigate('/'); setShowLogout(false) }}
                  style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: 'none', background: '#fff', color: '#000', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', transition: 'opacity 0.15s' }}
                  onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.88')}
                  onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
                >
                  Sign Out
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
