
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { Html, PointerLockControls, useTexture } from '@react-three/drei'
import * as THREE from 'three'

/**
 * Cyber Hunt — Desert Pack
 * - Large desert with dunes (procedural), rocks, bushes, cacti
 * - First-person movement (WASD, Shift to sprint). Click the header button to lock mouse.
 * - Click DIG to excavate the 1x1 ft tile under the crosshair
 * - Keeps treasure/digging logic and 10M sq ft world size
 */

const WORLD_W = 3163
const WORLD_H = 3162
const VIEW_W = 200
const VIEW_H = 200
const DAILY_FREE_DIGS = 1

const KEY = {
  DIGS: 'cth_digs',
  USER: 'cth_user',
  OFFSET: 'cth_offset',
  TREASURE: 'cth_treasure',
  ENDED: 'cth_game_end',
  LAST_DIG_DAY: 'cth_last_dig_day',
  EXTRA_DIGS: 'cth_extra_digs',
}

const todayStr = () => new Date().toISOString().slice(0,10)
const clamp = (v:number,a:number,b:number)=>Math.max(a,Math.min(b,v))
const randInt = (min:number,max:number)=>Math.floor(Math.random()*(max-min+1))+min
function seeded(x:number,y:number){ const s=Math.sin(x*127.1+y*311.7)*43758.5453; return s-Math.floor(s) }

function getOrCreateUser() {
  const existing = localStorage.getItem(KEY.USER)
  if (existing) return JSON.parse(existing)
  const id = crypto.randomUUID()
  const initials = (prompt('Enter your initials (2–3 letters) for your digs:')||'YOU').slice(0,3).toUpperCase()
  const user = { id, initials }
  localStorage.setItem(KEY.USER, JSON.stringify(user))
  return user
}
function getTreasure() {
  let t = localStorage.getItem(KEY.TREASURE)
  if (t) return JSON.parse(t)
  const seed = randInt(100000,999999)
  const x = randInt(0, WORLD_W-1)
  const y = randInt(0, WORLD_H-1)
  t = JSON.stringify({ x, y, seed })
  localStorage.setItem(KEY.TREASURE, t)
  return JSON.parse(t)
}
function getOffset() {
  const o = localStorage.getItem(KEY.OFFSET)
  if (o) return JSON.parse(o)
  const ox = Math.floor(WORLD_W/2 - VIEW_W/2)
  const oy = Math.floor(WORLD_H/2 - VIEW_H/2)
  const off = { ox, oy }
  localStorage.setItem(KEY.OFFSET, JSON.stringify(off))
  return off
}
function setOffset(off:{ox:number,oy:number}){ localStorage.setItem(KEY.OFFSET, JSON.stringify(off)) }

function loadDigs(){ return JSON.parse(localStorage.getItem(KEY.DIGS) || '{}') }
function saveDigs(d:any){ localStorage.setItem(KEY.DIGS, JSON.stringify(d)) }
function gameEnded(){ const e = localStorage.getItem(KEY.ENDED); return e?JSON.parse(e):null }
function endGame(winnerId:string,x:number,y:number){ localStorage.setItem(KEY.ENDED, JSON.stringify({ winnerId, x, y, ts: Date.now() })) }
function canDigToday(){
  const last = localStorage.getItem(KEY.LAST_DIG_DAY)
  const extra = Number(localStorage.getItem(KEY.EXTRA_DIGS) || 0)
  const today = todayStr()
  if (last !== today) {
    localStorage.setItem(KEY.LAST_DIG_DAY, today)
    return { freeLeft: DAILY_FREE_DIGS, extraLeft: extra }
  }
  const digs = JSON.parse(localStorage.getItem(KEY.DIGS) || '{}')
  const user = JSON.parse(localStorage.getItem(KEY.USER) || '{}')
  let usedToday = 0
  for (const k in digs) {
    const v = digs[k]
    if (v.ownerId === user.id && v.day === today) usedToday++
  }
  const freeLeft = Math.max(0, DAILY_FREE_DIGS - usedToday)
  return { freeLeft, extraLeft: extra }
}

const api = {
  async fetchWindow(ox:number, oy:number, w:number, h:number){
    const digs = loadDigs()
    const res:any[] = []
    for (const k in digs) {
      const [x,y] = k.split(',').map(Number)
      if (x>=ox && x<ox+w && y>=oy && y<oy+h) res.push({ x, y, ...digs[k] })
    }
    return res
  },
  async dig(x:number,y:number){
    if (gameEnded()) return { ok:false, reason:'Game over' }
    const { x:tx, y:ty } = getTreasure()
    const user = getOrCreateUser()
    const k = `${x},${y}`
    const digs = loadDigs()
    if (digs[k]) return { ok:false, reason:'Already dug' }
    const allowance = canDigToday()
    if (allowance.freeLeft<=0 && allowance.extraLeft<=0) return { ok:false, reason:'No digs left' }
    const today = todayStr()
    digs[k] = { ownerId: user.id, initials: user.initials, ts: Date.now(), day: today }
    saveDigs(digs)
    if (allowance.freeLeft<=0 && allowance.extraLeft>0) localStorage.setItem(KEY.EXTRA_DIGS, String(allowance.extraLeft-1))
    const found = (x===tx && y===ty)
    if (found) endGame(user.id,x,y)
    return { ok:true, found }
  },
  async buyDigs(count:number=5){
    const prev = Number(localStorage.getItem(KEY.EXTRA_DIGS) || 0)
    localStorage.setItem(KEY.EXTRA_DIGS, String(prev+count))
    return { ok:true, newBalance: prev+count }
  },
  async resetAll(){
    localStorage.removeItem(KEY.DIGS)
    localStorage.removeItem(KEY.ENDED)
    localStorage.removeItem(KEY.TREASURE)
  }
}

// ---------- Desert scene ----------

// dune height function (deterministic)
function duneHeight(x:number, z:number){
  const f1 = Math.sin(x*0.06) * 0.6 + Math.cos(z*0.05) * 0.6
  const f2 = Math.sin((x+z)*0.025) * 0.4 + Math.cos((x-z)*0.018) * 0.35
  return (f1 + f2) * 0.6
}

function Desert({ ox, oy, digsInView }:{ox:number,oy:number,digsInView:any[]}){
  const sand = useTexture('/textures_desert/sand.jpg')
  const sandNormal = useTexture('/textures_desert/sand_normal.jpg')
  const rock = useTexture('/textures_desert/rock.jpg')
  const bushTex = useTexture('/textures_desert/bush.png')
  const sky = useTexture('/textures_desert/sky.jpg')

  const { scene, gl } = useThree()
  useEffect(()=>{
    const tex = sky as THREE.Texture
    tex.mapping = THREE.EquirectangularReflectionMapping
    scene.background = tex
    gl.toneMapping = THREE.ACESFilmicToneMapping
    gl.toneMappingExposure = 1.0
  },[scene, gl, sky])

  ;[sand, sandNormal, rock].forEach((t:any)=>{ t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(20,20); t.anisotropy = 8 })

  const groundGeom = useMemo(()=>{
    const size = 200
    const segs = 200
    const geom = new THREE.PlaneGeometry(size, size, segs, segs)
    const pos = geom.attributes.position as THREE.BufferAttribute
    for (let i=0;i<pos.count;i++){
      const vx = pos.getX(i)
      const vz = pos.getY(i) // plane is XY before rotation
      const h = duneHeight(vx, vz)
      pos.setZ(i, h)
    }
    pos.needsUpdate = true
    geom.computeVertexNormals()
    return geom
  },[])

  const rockGeom = useMemo(()=> new THREE.DodecahedronGeometry(0.5, 0), [])
  const bushGeom = useMemo(()=> new THREE.PlaneGeometry(1,1), [])
  const cactusGeom = useMemo(()=> new THREE.CylinderGeometry(0.12, 0.14, 2.2, 8), [])

  const groundMat = useMemo(()=> new THREE.MeshStandardMaterial({
    map: sand as THREE.Texture, normalMap: sandNormal as THREE.Texture, roughness: 1.0, metalness: 0.0
  }), [sand, sandNormal])
  const rockMat = useMemo(()=> new THREE.MeshStandardMaterial({ map: rock as THREE.Texture, roughness: 0.9 }), [rock])
  const bushMat = useMemo(()=> new THREE.MeshBasicMaterial({ map: bushTex as THREE.Texture, transparent: true, depthWrite: false }), [bushTex])
  const cactusMat = useMemo(()=> new THREE.MeshStandardMaterial({ color: '#3a8f2b', roughness: 0.8 }), [])

  // scatter instances
  const rocks = useRef<THREE.InstancedMesh>(null!)
  const bushes = useRef<THREE.InstancedMesh>(null!)
  const cacti = useRef<THREE.InstancedMesh>(null!)

  useEffect(()=>{
    if (!rocks.current || !bushes.current || !cacti.current) return
    const dummy = new THREE.Object3D()
    let ri=0, bi=0, ci=0
    for (let i=0;i<800;i++){
      const x = (Math.random()-0.5)*180
      const z = (Math.random()-0.5)*180
      const y = duneHeight(x, z)
      dummy.position.set(x, y+0.1, z)
      dummy.rotation.set(0, Math.random()*Math.PI*2, 0)
      const s = 0.4 + Math.random()*0.8
      dummy.scale.set(s,s,s)
      dummy.updateMatrix()
      rocks.current.setMatrixAt(ri++, dummy.matrix)
    }
    for (let i=0;i<600;i++){
      const x = (Math.random()-0.5)*180
      const z = (Math.random()-0.5)*180
      const y = duneHeight(x, z)
      dummy.position.set(x, y+0.05, z)
      dummy.rotation.set(0, Math.random()*Math.PI*2, 0)
      const s = 1 + Math.random()*1.5
      dummy.scale.set(s, s, 1)
      dummy.updateMatrix()
      bushes.current.setMatrixAt(bi++, dummy.matrix)
    }
    for (let i=0;i<150;i++){
      const x = (Math.random()-0.5)*180
      const z = (Math.random()-0.5)*180
      const y = duneHeight(x, z)
      dummy.position.set(x, y+1.1, z)
      dummy.rotation.set(0, Math.random()*Math.PI*2, 0)
      const s = 0.8 + Math.random()*0.8
      dummy.scale.set(1,s,1)
      dummy.updateMatrix()
      cacti.current.setMatrixAt(ci++, dummy.matrix)
    }
    rocks.current.count = ri; rocks.current.instanceMatrix.needsUpdate = true
    bushes.current.count = bi; bushes.current.instanceMatrix.needsUpdate = true
    cacti.current.count = ci; cacti.current.instanceMatrix.needsUpdate = true
  }, [])

  return (
    <group>
      <mesh geometry={groundGeom} material={groundMat} rotation-x={-Math.PI/2} receiveShadow castShadow />
      <instancedMesh ref={rocks} args={[rockGeom, rockMat, 1000]} castShadow receiveShadow />
      <instancedMesh ref={bushes} args={[bushGeom, bushMat, 800]} castShadow={false} receiveShadow={false} rotation-y={Math.PI/4} />
      <instancedMesh ref={cacti} args={[cactusGeom, cactusMat, 200]} castShadow receiveShadow />
      {digsInView.map(d => (
        <Html key={`${d.x},${d.y}`} center transform distanceFactor={25}
          position={[(d.x - ox - VIEW_W/2), duneHeight(d.x - ox - VIEW_W/2, d.y - oy - VIEW_H/2)+0.3, (d.y - oy - VIEW_H/2)]}>
          <div className="text-[10px] md:text-xs tracking-widest font-bold text-amber-200/90"
            style={{ textShadow: '0 0 6px rgba(255,220,120,0.8)' }}>{d.initials}</div>
        </Html>
      ))}
    </group>
  )
}

// --- Controls: FP movement with pointer lock; updates ox/oy as you walk ---
function DesertControls({ setHovered, setOff }:{ setHovered:(v:any)=>void, setOff:(fn:(o:{ox:number,oy:number})=>{ox:number,oy:number})=>void }){
  const { camera } = useThree()
  const keys = useRef<{[k:string]:boolean}>({})
  const velocity = useRef(new THREE.Vector3())
  const dir = useRef(new THREE.Vector3())
  const raycaster = useMemo(()=>new THREE.Raycaster(),[])
  const plane = useMemo(()=>new THREE.Plane(new THREE.Vector3(0,1,0), 0),[])

  useEffect(()=>{
    camera.position.set(0, 1.7, 6)
    camera.lookAt(0,1.6,0)
  }, [camera])

  useEffect(()=>{
    const down = (e:KeyboardEvent)=>{ keys.current[e.key.toLowerCase()] = true }
    const up = (e:KeyboardEvent)=>{ keys.current[e.key.toLowerCase()] = false }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return ()=>{ window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [])

  useFrame((state, dt)=>{
    const delta = Math.min(0.05, dt)
    dir.current.set(0,0,0)
    if (keys.current['w']) dir.current.z -= 1
    if (keys.current['s']) dir.current.z += 1
    if (keys.current['a']) dir.current.x -= 1
    if (keys.current['d']) dir.current.x += 1
    dir.current.normalize()
    const speed = (keys.current['shift']) ? 16 : 8
    velocity.current.copy(dir.current).applyQuaternion(camera.quaternion).multiplyScalar(speed*delta)
    camera.position.add(new THREE.Vector3(velocity.current.x, 0, velocity.current.z))
    // keep camera slightly above dune height
    const y = duneHeight(camera.position.x, camera.position.z) + 1.7
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, y, 0.6)

    // update world window offsets so digging maps to where we walk
    setOff(o=>{
      const nx = clamp(Math.floor(o.ox + velocity.current.x), 0, WORLD_W - VIEW_W)
      const ny = clamp(Math.floor(o.oy + velocity.current.z), 0, WORLD_H - VIEW_H)
      return (nx!==o.ox || ny!==o.oy) ? {ox:nx, oy:ny} : o
    })

    // update hovered from crosshair
    raycaster.setFromCamera(new THREE.Vector2(0,0), camera as any)
    const p = new THREE.Vector3()
    raycaster.ray.intersectPlane(plane, p)
    const gx = Math.round(p.x + VIEW_W/2)
    const gy = Math.round(p.z + VIEW_H/2)
    const wx = clamp(gx, 0, WORLD_W-1)
    const wy = clamp(gy, 0, WORLD_H-1)
    if (gx>=0 && gx<VIEW_W && gy>=0 && gy<VIEW_H) setHovered({ x: wx, y: wy })
    else setHovered(null)
  })

  return <PointerLockControls selector="#enter-desert" />
}

export default function App(){
  const [user, setUser] = useState<any>(null)
  const [{ox,oy}, setOff] = useState(getOffset())
  const [hovered, setHovered] = useState<{x:number,y:number}|null>(null)
  const [digs, setDigs] = useState<any[]>([])
  const [freeLeft, setFreeLeft] = useState(DAILY_FREE_DIGS)
  const [extraLeft, setExtraLeft] = useState(0)
  const ended = gameEnded()

  useEffect(()=>{ setUser(getOrCreateUser()); const a=canDigToday(); setFreeLeft(a.freeLeft); setExtraLeft(a.extraLeft) },[])

  useEffect(()=>{
    let mounted = true
    api.fetchWindow(ox,oy,VIEW_W,VIEW_H).then(res=>mounted && setDigs(res))
    setOffset({ox,oy})
    return ()=>{ mounted=false }
  },[ox,oy])

  const handleDig = async()=>{
    if (!hovered) return
    const res = await api.dig(hovered.x, hovered.y)
    if (!res.ok){ alert(res.reason); return }
    if (res.found) alert('🎉 YOU FOUND THE TREASURE! The game is over.')
    const a = canDigToday(); setFreeLeft(a.freeLeft); setExtraLeft(a.extraLeft)
    const win = await api.fetchWindow(ox,oy,VIEW_W,VIEW_H); setDigs(win)
  }

  return (
    <div className="min-h-screen w-full" style={{ background: '#0b0f14', color: 'white' }}>
      <header className="flex items-center justify-between p-4 md:p-6 border-b border-cyan-500/20 sticky top-0 z-20" style={{ background: '#0b0f14CC', backdropFilter:'blur(6px)' }}>
        <h1 className="text-xl md:text-2xl font-extrabold tracking-tight">CYBER HUNT<span className="text-cyan-400">.</span></h1>
        <button id="enter-desert" className="rounded px-3 py-2 bg-cyan-600 hover:bg-cyan-500">Click to enter Desert View</button>
      </header>

      <main className="grid md:grid-cols-[320px_1fr] gap-4 md:gap-6 p-4 md:p-6">
        <div className="bg-[#0e141c] border border-cyan-500/20 rounded-2xl p-4 md:p-6">
          <div className="space-y-4">
            <div>
              <div className="text-sm text-white/60">Player</div>
              <div className="text-lg font-semibold">{user?.initials || 'YOU'}</div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="rounded-xl bg-cyan-500/10 p-3">
                <div className="text-2xl font-bold text-cyan-300">{freeLeft}</div>
                <div className="text-xs text-white/60">Free digs today</div>
              </div>
              <div className="rounded-xl bg-fuchsia-500/10 p-3">
                <div className="text-2xl font-bold text-fuchsia-300">{extraLeft}</div>
                <div className="text-xs text-white/60">Extra digs</div>
              </div>
            </div>
            <div className="text-sm text-white/70">Click the button above to lock the mouse. Use <b>W/A/S/D</b> to walk, <b>Shift</b> to sprint. Click <b>DIG</b> to excavate the tile under the crosshair.</div>
            <button onClick={handleDig} className="mt-2 bg-cyan-600 hover:bg-cyan-500 w-full rounded-lg px-3 py-2 font-semibold">DIG</button>
            <div className="text-xs text-white/40 pt-2">
              {ended ? <div className="text-fuchsia-300">Game ended. Treasure found at ({ended.x}, {ended.y}).</div> : <div>Find the hidden cache. First to hit the exact square wins. 🏴‍☠️</div>}
            </div>
          </div>
        </div>

        <div className="relative rounded-2xl overflow-hidden border border-cyan-500/20" style={{ height: '70vh' }}>
          <Canvas shadows camera={{ fov: 70 }}>
            <hemisphereLight skyColor={'#ffe'} groundColor={'#885'} intensity={0.6} />
            <directionalLight position={[12, 30, -12]} intensity={1.2} castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048} />
            <DesertControls setHovered={setHovered} setOff={setOff} />
            <Desert ox={ox} oy={oy} digsInView={digs} />
            <Html center>
              <div style={{ width: 10, height: 10, borderRadius: 9999, border: '2px solid rgba(255,255,255,0.9)' }}></div>
            </Html>
          </Canvas>
        </div>
      </main>
    </div>
  )
}
