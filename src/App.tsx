
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, Html } from '@react-three/drei'
import * as THREE from 'three'

const WORLD_W = 3163
const WORLD_H = 3162
const VIEW_W = 200
const VIEW_H = 200
const TILE_SIZE = 1
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
function setOffset(off:{ox:number,oy:number}) { localStorage.setItem(KEY.OFFSET, JSON.stringify(off)) }

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

    if (allowance.freeLeft<=0 && allowance.extraLeft>0) {
      localStorage.setItem(KEY.EXTRA_DIGS, String(allowance.extraLeft-1))
    }

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

function CyberLights() {
  const { scene } = useThree()
  useEffect(() => {
    scene.fog = new THREE.Fog('#071018', 10, 60)
    return () => { (scene as any).fog = null }
  }, [scene])
  return (
    <>
      <ambientLight intensity={0.35} />
      <pointLight position={[10,20,10]} intensity={1.2} color={'#00fff0'} />
      <spotLight position={[-20,25,-10]} intensity={0.8} angle={0.4} penumbra={0.3} />
    </>
  )
}

function NeonGrid({ ox, oy, hovered, digsInView }:{ox:number,oy:number,hovered:{x:number,y:number}|null,digsInView:any[]}){
  const meshRef = useRef<THREE.InstancedMesh>(null!)
  const geom = useMemo(()=>new THREE.PlaneGeometry(TILE_SIZE,TILE_SIZE),[])
  const mat = useMemo(()=>new THREE.MeshStandardMaterial({
    color: new THREE.Color('#0b0f14'),
    emissive: new THREE.Color('#00c0a8'),
    emissiveIntensity: 0.35,
    roughness: 0.9,
    metalness: 0.1,
    side: THREE.DoubleSide
  }),[])
  const cells = useMemo(()=>VIEW_W*VIEW_H,[])
  const dugMap = useMemo(()=>{
    const m = new Map<string, any>()
    digsInView.forEach(d=>m.set(`${d.x},${d.y}`, d))
    return m
  },[digsInView])

  useEffect(()=>{
    if (!meshRef.current) return
    const m = meshRef.current
    m.count = cells
    const dummy = new THREE.Object3D()
    let i=0
    for (let yy=0; yy<VIEW_H; yy++){
      for (let xx=0; xx<VIEW_W; xx++){
        const wx = ox+xx, wy = oy+yy
        dummy.position.set((xx - VIEW_W/2), 0, (yy - VIEW_H/2))
        dummy.scale.set(1,1,1)
        dummy.updateMatrix()
        m.setMatrixAt(i, dummy.matrix)
        const dug = dugMap.get(`${wx},${wy}`)
        const isHovered = hovered && hovered.x===wx && hovered.y===wy
        const color = new THREE.Color(dug ? '#ff00f0' : isHovered ? '#00fff0' : '#10202a')
        m.setColorAt(i, color as any)
        i++
      }
    }
    ;(m.instanceColor as any).needsUpdate = true
    m.instanceMatrix.needsUpdate = true
  },[ox,oy,hovered,dugMap,cells])

  return (
    <group>
      <instancedMesh ref={meshRef} args={[geom, mat, cells]} />
      {digsInView.map(d=> (
        <Html key={`${d.x},${d.y}`} center transform distanceFactor={15}
          position={[(d.x-ox - VIEW_W/2), 0.01, (d.y-oy - VIEW_H/2)]}>
          <div className="text-[10px] md:text-xs tracking-widest font-bold text-cyan-300/90"
            style={{ textShadow: '0 0 6px #00fff0' }}>{d.initials}</div>
        </Html>
      ))}
    </group>
  )
}

function HoverPicker({ ox, oy, setHovered }:{ox:number,oy:number,setHovered:(v:any)=>void}){
  const ref = useRef<THREE.Group>(null!)
  const { camera } = useThree()
  const raycaster = useMemo(()=>new THREE.Raycaster(),[])
  const plane = useMemo(()=>new THREE.Plane(new THREE.Vector3(0,1,0), 0),[])
  const mouse = useRef(new THREE.Vector2())

  useEffect(()=>{
    const dom = (document.querySelector('canvas') as HTMLCanvasElement)
    if (!dom) return
    const onMove = (e:MouseEvent)=>{
      const rect = dom.getBoundingClientRect()
      mouse.current.x = ((e.clientX - rect.left)/rect.width)*2 - 1
      mouse.current.y = -((e.clientY - rect.top)/rect.height)*2 + 1
      raycaster.setFromCamera(mouse.current, camera)
      const p = new THREE.Vector3()
      raycaster.ray.intersectPlane(plane, p)
      const gx = Math.round(p.x + VIEW_W/2)
      const gy = Math.round(p.z + VIEW_H/2)
      const wx = clamp(ox + gx, 0, WORLD_W-1)
      const wy = clamp(oy + gy, 0, WORLD_H-1)
      if (gx>=0 && gx<VIEW_W && gy>=0 && gy<VIEW_H) setHovered({ x: wx, y: wy })
      else setHovered(null)
    }
    dom.addEventListener('mousemove', onMove)
    return ()=>dom.removeEventListener('mousemove', onMove)
  },[camera, plane, ox, oy, setHovered])

  return <group ref={ref} />
}

export default function App(){
  const [user, setUser] = useState<any>(null)
  const [{ox,oy}, setOff] = useState(getOffset())
  const [hovered, setHovered] = useState<{x:number,y:number}|null>(null)
  const [digs, setDigs] = useState<any[]>([])
  const [freeLeft, setFreeLeft] = useState(DAILY_FREE_DIGS)
  const [extraLeft, setExtraLeft] = useState(0)
  const ended = gameEnded()

  useEffect(()=>{
    setUser(getOrCreateUser())
    const a = canDigToday()
    setFreeLeft(a.freeLeft)
    setExtraLeft(a.extraLeft)
  },[])

  useEffect(()=>{
    let mounted = true
    api.fetchWindow(ox,oy,VIEW_W,VIEW_H).then(res=>mounted && setDigs(res))
    setOffset({ox,oy})
    return ()=>{ mounted = false }
  },[ox,oy])

  useEffect(()=>{
    const onKey = (e:KeyboardEvent)=>{
      if (['INPUT','TEXTAREA'].includes((document.activeElement as any)?.tagName)) return
      let nx = ox, ny = oy
      const step = 25
      if (e.key==='w' || e.key==='ArrowUp') ny -= step
      if (e.key==='s' || e.key==='ArrowDown') ny += step
      if (e.key==='a' || e.key==='ArrowLeft') nx -= step
      if (e.key==='d' || e.key==='ArrowRight') nx += step
      nx = clamp(nx, 0, WORLD_W - VIEW_W)
      ny = clamp(ny, 0, WORLD_H - VIEW_H)
      if (nx!==ox || ny!==oy) setOff({ ox:nx, oy:ny })
    }
    window.addEventListener('keydown', onKey)
    return ()=>window.removeEventListener('keydown', onKey)
  },[ox,oy])

  const handleDig = async()=>{
    if (!hovered) return
    const { x, y } = hovered
    const res = await api.dig(x,y)
    if (!res.ok){ alert(res.reason); return }
    if (res.found){ alert('🎉 YOU FOUND THE TREASURE! The game is over.') }
    const a = canDigToday()
    setFreeLeft(a.freeLeft)
    setExtraLeft(a.extraLeft)
    const win = await api.fetchWindow(ox,oy,VIEW_W,VIEW_H)
    setDigs(win)
  }

  const buyMore = async()=>{
    const count = Number(prompt('How many extra digs?', '5') || 0)
    if (!count) return
    const res = await api.buyDigs(count)
    if (res.ok) { setExtraLeft(res.newBalance); alert(`Purchased ${count} extra digs.`) }
  }

  return (
    <div className="min-h-screen w-full">
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(circle at 10% 10%, rgba(0,255,240,.08), transparent 40%), radial-gradient(circle at 90% 30%, rgba(255,0,240,.08), transparent 40%)' }} />

      <header className="flex items-center justify-between p-4 md:p-6 border-b border-cyan-500/20 sticky top-0 z-20 bg-[#05080d]/70 backdrop-blur">
        <h1 className="text-xl md:text-2xl font-extrabold tracking-tight">
          CYBER HUNT<span className="text-cyan-400">.</span>
        </h1>
        <div className="flex items-center gap-2 text-xs md:text-sm">
          <span className="px-2 py-1 rounded-full bg-cyan-500/10 text-cyan-300">World: {WORLD_W.toLocaleString()} × {WORLD_H.toLocaleString()} ft</span>
          <span className="px-2 py-1 rounded-full bg-fuchsia-500/10 text-fuchsia-300">Viewport: {VIEW_W} × {VIEW_H}</span>
        </div>
      </header>

      <main className="grid md:grid-cols-[320px_1fr] gap-4 md:gap-6 p-4 md:p-6">
        <div className="bg-[#070b12] border border-cyan-500/20 rounded-2xl p-4 md:p-6">
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
            <div className="space-y-2 text-sm">
              <div className="text-white/80">Controls</div>
              <ul className="list-disc list-inside text-white/60">
                <li>W/A/S/D or Arrow Keys to scroll the world</li>
                <li>Hover a cell to target, click DIG to excavate</li>
                <li>One free square-foot per day; buy more if needed</li>
              </ul>
            </div>
            <div className="flex gap-2">
              <button onClick={handleDig} className="bg-cyan-600 hover:bg-cyan-500 w-full rounded-lg px-3 py-2 font-semibold">DIG</button>
              <button onClick={buyMore} className="bg-white/10 hover:bg-white/20 w-full rounded-lg px-3 py-2 font-semibold">Buy Digs</button>
            </div>
            <div className="text-xs text-white/40 pt-2">
              {ended ? (
                <div className="text-fuchsia-300">Game ended. Treasure found at ({ended.x}, {ended.y}).</div>
              ) : (
                <div>Find the hidden cache. First to hit the exact square wins. 🏴‍☠️</div>
              )}
            </div>
            <div className="pt-2 border-t border-white/10 text-xs text-white/40">
              <div className="mb-1 font-semibold text-white/60">Admin (demo)</div>
              <div className="flex gap-2">
                <button className="h-8 px-3 rounded border border-white/20" onClick={async()=>{ await api.resetAll(); location.reload() }}>Reset World</button>
                <button className="h-8 px-3 rounded border border-white/20" onClick={()=>{
                  const t = getTreasure()
                  alert(`Treasure seed (demo only): ${t.seed}\nHidden at: (${t.x}, ${t.y})`)
                }}>Reveal Treasure (demo)</button>
              </div>
              <div className="mt-2">Replace mock API with server endpoints before launch.</div>
            </div>
          </div>
        </div>

        <div className="relative rounded-2xl overflow-hidden border border-cyan-500/20" style={{ height: '70vh' }}>
          <Canvas dpr={[1,2]} camera={{ fov: 40 }}>
            <CameraRig />
            <CyberLights />
            <OrbitControls enablePan={false} enableZoom={true} minDistance={10} maxDistance={45} />
            <HoverPicker ox={ox} oy={oy} setHovered={setHovered} />
            <WorldView ox={ox} oy={oy} hovered={hovered} />
          </Canvas>

          <div className="absolute top-2 left-2 text-xs md:text-sm bg-black/40 backdrop-blur px-2 py-1 rounded">
            <div>Offset: <span className="text-cyan-300">({ox}, {oy})</span></div>
            <div>Hover: <span className="text-fuchsia-300">{hovered ? `(${hovered.x}, ${hovered.y})` : '—'}</span></div>
          </div>

          <div className="absolute bottom-3 right-3 grid grid-cols-3 gap-1 text-xs select-none">
            {['▲','◀','▶','▼'].map((txt,i)=>{
              const onClick = ()=>{
                const step = 25
                let nx = ox, ny = oy
                if (txt==='▲') ny -= step
                if (txt==='▼') ny += step
                if (txt==='◀') nx -= step
                if (txt==='▶') nx += step
                nx = clamp(nx, 0, WORLD_W - VIEW_W)
                ny = clamp(ny, 0, WORLD_H - VIEW_H)
                setOff({ ox:nx, oy:ny })
              }
              return <button key={i} onClick={onClick} className="bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 rounded px-3 py-2">{txt}</button>
            })}
          </div>
        </div>
      </main>

      <footer className="p-4 md:p-6 text-center text-xs text-white/40">
        Built with @react-three/fiber • Styled with Tailwind • Prototype payment. Replace before launch.
      </footer>
    </div>
  )
}

function WorldView({ ox, oy, hovered }:{ox:number,oy:number,hovered:{x:number,y:number}|null}){
  const [digs, setDigs] = useState<any[]>([])

  useEffect(()=>{
    let mounted = true
    ;(async()=>{
      const res = await api.fetchWindow(ox,oy,VIEW_W,VIEW_H)
      if (mounted) setDigs(res)
    })()
    return ()=>{ mounted = false }
  },[ox,oy])

  return <NeonGrid ox={ox} oy={oy} hovered={hovered} digsInView={digs} />
}

function CameraRig(){
  const { camera } = useThree()
  useEffect(()=>{
    camera.position.set(0,18,18)
    camera.lookAt(0,0,0)
  },[camera])
  return null
}
