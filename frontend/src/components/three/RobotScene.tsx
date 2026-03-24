'use client'
import { useRef, useMemo, Suspense } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Grid, Stars } from '@react-three/drei'
import { EffectComposer, Bloom, ChromaticAberration, Vignette } from '@react-three/postprocessing'
import { BlendFunction } from 'postprocessing'
import * as THREE from 'three'

// Procedural Robot Arm
function RobotArm({ mousePos }: { mousePos: React.MutableRefObject<[number, number]> }) {
  const root   = useRef<THREE.Group>(null)
  const j1     = useRef<THREE.Group>(null)
  const j2     = useRef<THREE.Group>(null)
  const j3     = useRef<THREE.Group>(null)
  const gripper = useRef<THREE.Group>(null)

  const metalMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#0d2035', metalness: 0.95, roughness: 0.15,
    emissive: '#06b6d4', emissiveIntensity: 0.04,
  }), [])

  const glowMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#06b6d4', emissive: '#06b6d4', emissiveIntensity: 1.0,
    transparent: true, opacity: 0.85,
  }), [])

  const accentMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#3b82f6', emissive: '#3b82f6', emissiveIntensity: 0.7,
    transparent: true, opacity: 0.7,
  }), [])

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const [mx, my] = mousePos.current
    if (root.current) {
      root.current.rotation.y = THREE.MathUtils.lerp(root.current.rotation.y, mx * 0.5 + Math.sin(t * 0.25) * 0.15, 0.05)
      root.current.rotation.x = THREE.MathUtils.lerp(root.current.rotation.x, my * 0.08, 0.05)
    }
    if (j1.current) j1.current.rotation.z = Math.sin(t * 0.5) * 0.35 - 0.1
    if (j2.current) j2.current.rotation.z = Math.sin(t * 0.4 + 1.2) * 0.4 - 0.2
    if (j3.current) j3.current.rotation.z = Math.sin(t * 0.6 + 2.4) * 0.35
    if (gripper.current) {
      const open = (Math.sin(t * 0.8) * 0.5 + 0.5) * 0.04
      gripper.current.children.forEach((c, i) => {
        if (c instanceof THREE.Mesh) c.position.y = i === 0 ? open : -open
      })
    }
  })

  return (
    <group ref={root} position={[0, -0.6, 0]} scale={8}>
      {/* Base */}
      <mesh material={metalMat} castShadow>
        <cylinderGeometry args={[0.07, 0.09, 0.03, 24]} />
      </mesh>
      {/* Base ring glow */}
      <mesh position={[0, 0.015, 0]} material={glowMat}>
        <torusGeometry args={[0.075, 0.004, 8, 32]} />
      </mesh>

      {/* Waist */}
      <group position={[0, 0.04, 0]}>
        <mesh material={metalMat} castShadow>
          <cylinderGeometry args={[0.045, 0.055, 0.05, 16]} />
        </mesh>

        {/* Link 1 */}
        <group ref={j1} position={[0, 0.045, 0]}>
          <mesh material={metalMat} castShadow rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.038, 0.038, 0.1, 14]} />
          </mesh>
          <mesh position={[0, 0, 0.05]} material={glowMat} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.04, 0.004, 8, 24]} />
          </mesh>

          {/* Link 2 (upper arm) */}
          <group ref={j2} position={[0, 0, -0.06]}>
            <mesh material={metalMat} castShadow>
              <boxGeometry args={[0.028, 0.12, 0.028]} />
            </mesh>
            {/* joint accent */}
            <mesh position={[0, 0.06, 0]} material={accentMat}>
              <sphereGeometry args={[0.018, 12, 12]} />
            </mesh>

            {/* Link 3 (forearm) */}
            <group ref={j3} position={[0, 0.07, 0]}>
              <mesh material={metalMat} castShadow>
                <boxGeometry args={[0.022, 0.09, 0.022]} />
              </mesh>
              <mesh position={[0, 0.045, 0]} material={accentMat}>
                <sphereGeometry args={[0.014, 10, 10]} />
              </mesh>

              {/* Gripper */}
              <group ref={gripper} position={[0, 0.065, 0]}>
                <mesh material={glowMat} castShadow>
                  <boxGeometry args={[0.018, 0.012, 0.042]} />
                </mesh>
                {/* Fingers */}
                {[0.014, -0.014].map((y, i) => (
                  <mesh key={i} position={[0, y, 0.018]} material={glowMat} castShadow>
                    <boxGeometry args={[0.007, 0.024, 0.007]} />
                  </mesh>
                ))}
              </group>
            </group>
          </group>
        </group>
      </group>
    </group>
  )
}

// Particle field
function Particles() {
  const ref = useRef<THREE.Points>(null)
  const N = 1000
  const pos = useMemo(() => {
    const arr = new Float32Array(N * 3)
    for (let i = 0; i < N; i++) {
      arr[i * 3]     = (Math.random() - 0.5) * 24
      arr[i * 3 + 1] = (Math.random() - 0.5) * 12
      arr[i * 3 + 2] = (Math.random() - 0.5) * 24
    }
    return arr
  }, [])

  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.y = clock.elapsedTime * 0.015
  })

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={N} array={pos} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial color="#06b6d4" size={0.025} transparent opacity={0.5} sizeAttenuation />
    </points>
  )
}

// Holographic data rings
function DataRings() {
  const ref = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.rotation.y = clock.elapsedTime * 0.08
      ref.current.rotation.z = clock.elapsedTime * 0.03
    }
  })
  return (
    <group ref={ref} position={[0, 0.6, 0]}>
      {[1.4, 1.9, 2.4].map((r, i) => (
        <mesh key={r} rotation={[Math.PI / 2 + i * 0.4, 0, i * 0.6] as [number, number, number]}>
          <torusGeometry args={[r, 0.003, 8, 80]} />
          <meshStandardMaterial
            color="#06b6d4" emissive="#06b6d4"
            emissiveIntensity={0.6} transparent opacity={0.35 - i * 0.08}
          />
        </mesh>
      ))}
    </group>
  )
}

// Scene
function Scene({ mousePos }: { mousePos: React.MutableRefObject<[number, number]> }) {
  return (
    <>
      <ambientLight intensity={0.15} />
      <pointLight position={[3, 4, 3]} intensity={3} color="#06b6d4" />
      <pointLight position={[-3, 1, -3]} intensity={1.5} color="#3b82f6" />
      <pointLight position={[0, -2, 1]} intensity={0.8} color="#06b6d4" castShadow />

      <Stars radius={80} depth={40} count={3000} factor={3} saturation={0} fade speed={0.5} />
      <Particles />
      <DataRings />
      <RobotArm mousePos={mousePos} />

      <Grid
        position={[0, -1.8, 0]}
        args={[30, 30]}
        cellSize={0.6}
        cellThickness={0.4}
        cellColor="#0c2a40"
        sectionSize={3}
        sectionThickness={0.8}
        sectionColor="#06b6d4"
        fadeDistance={18}
        fadeStrength={1.2}
        infiniteGrid
      />

      <EffectComposer>
        <Bloom luminanceThreshold={0.08} luminanceSmoothing={0.85} intensity={2.5} blendFunction={BlendFunction.ADD} />
        <ChromaticAberration blendFunction={BlendFunction.NORMAL} offset={new THREE.Vector2(0.0008, 0.0008) as any} radialModulation={false} modulationOffset={0} />
        <Vignette eskil={false} offset={0.25} darkness={0.85} />
      </EffectComposer>
    </>
  )
}

export default function RobotScene({ mousePos }: { mousePos: React.MutableRefObject<[number, number]> }) {
  return (
    <Canvas
      camera={{ position: [0, 0.8, 4.5], fov: 55, near: 0.01, far: 200 }}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
      style={{ background: '#020817' }}
      shadows
      dpr={[1, 2]}
    >
      <Suspense fallback={null}>
        <Scene mousePos={mousePos} />
      </Suspense>
    </Canvas>
  )
}
