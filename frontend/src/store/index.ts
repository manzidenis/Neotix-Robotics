import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Auth store
interface AuthState {
  token: string | null
  user: { id: number; username: string; email: string } | null
  setAuth: (token: string, user: { id: number; username: string; email: string }) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      setAuth: (token, user) => set({ token, user }),
      logout: () => set({ token: null, user: null }),
    }),
    { name: 'neotix-auth' }
  )
)

// App state store
interface AppState {
  activeDatasetId: number | null
  activeDatasetName: string | null
  activeDatasetType: 'single' | 'bimanual' | null
  setActiveDataset: (id: number | null, name: string | null, type?: 'single' | 'bimanual') => void

  // Simulator
  simulatorConnected: boolean
  simulatorPlaying: boolean
  simulatorFrame: number
  simulatorTotalFrames: number
  simulatorCamera: { azimuth: number; elevation: number; distance: number }
  setSimulatorConnected: (v: boolean) => void
  setSimulatorPlaying: (v: boolean) => void
  setSimulatorFrame: (frame: number, total: number) => void
  setSimulatorCamera: (cam: { azimuth: number; elevation: number; distance: number }) => void
}

export const useAppStore = create<AppState>((set) => ({
  activeDatasetId: null,
  activeDatasetName: null,
  activeDatasetType: null,
  setActiveDataset: (id, name, type) =>
    set({ activeDatasetId: id, activeDatasetName: name, activeDatasetType: type ?? null }),

  simulatorConnected: false,
  simulatorPlaying: false,
  simulatorFrame: 0,
  simulatorTotalFrames: 0,
  simulatorCamera: { azimuth: 135, elevation: -20, distance: 1.5 },
  setSimulatorConnected: (v) => set({ simulatorConnected: v }),
  setSimulatorPlaying: (v) => set({ simulatorPlaying: v }),
  setSimulatorFrame: (frame, total) =>
    set({ simulatorFrame: frame, simulatorTotalFrames: total }),
  setSimulatorCamera: (cam) => set({ simulatorCamera: cam }),
}))
