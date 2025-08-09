
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Html, PointerLockControls, useTexture } from '@react-three/drei'
import * as THREE from 'three'

/**
 * Cyber Hunt — Desert Fix Build (no postprocessing; R3F v8-friendly)
 * - Click inside the 3D canvas to lock the mouse (browser requirement)
 * - Move with WASD (Shift = sprint)
 * - Hover ring + arrow shows exactly where you'll dig
 * - Click the 3D canvas to dig at the highlighted spot
 * - Miss => red flag + initials; Hit => chest & game ends
 * - Minimap + Map overlay for current window
 */

// ---- World config (keep 10M sq ft: ~3163 x 3162) ----
const WORLD_W = 3163
const WORLD_H = 3162
const VIEW_W = 200
const VIEW_H = 200
const DAILY_FREE_DIGS = 1

// ---- Storage keys ----
const KEY = {
  DIGS: 'cth_digs',
  USER: 'cth_user',
  OFFSET: 'cth_offset',
  TREASURE: 'cth_treasure',
  ENDED: 'cth_game_end',
  LAST_DIG_DAY: 'cth_last_day',
  EXTRA: 'cth_extra_digs',
}

const clamp = (v:number,a:number,b:number)=>Math.max(a,Math.min(b,v))
const today = () => new Date().toISOString().slice(0,10)
const randInt = (min:number,max:number)=>Math.floor(Math.random()*(max-min+1))+min

// ---- Persistence helpers ----
function getUser(){
  const u = localStorage.getItem(KEY.USER)
  if (u) return JSON.parse(u)
  const id = crypto.randomUUID()
  const initials = (prompt('Enter your initials (2–3 letters):') || 'YOU').slice(0,3).toUpperCase()
  const user = { id, initials }
  localStorage.setItem(KEY.USER, JSON.stringify(user))
  return user
}
function getTreasure(){
  const t = localStorage.getItem(KEY.TREASURE)
  if (t) return JSON.parse(t)
  const x = randInt(0, WORLD_W-1)
  const y = randInt(0, WORLD_H-1)
  const obj = { x, y, ts: Date.now() }
  localStorage.setItem(KEY.TREASURE, JSON.stringify(obj))
  return obj
}
function getOffset(){
  const o = localStorage.getItem(KEY.OFFSET)
  if (o) return JSON.parse(o)
  const ox = Math.floor(WORLD_W/2 - VIEW_W/2)
  const oy = Math.floor(WORLD_H/2 - VIEW_H/2)
  const off = { ox, oy }
  localStorage.setItem(KEY.OFFSET, JSON.stringify(off))
  return off
}
function setOffset(o:{ox:number,oy:number}){ localStorage.setItem(KEY.OFFSET, JSON.stringify(o)) }
function loadDigs(){ return JSON.parse(localStorage.getItem(KEY.DIGS) || '{}') }
function saveDigs(d:any){ localStorage.setItem(KEY.DIGS, JSON.stringify(d)) }
function getEnded(){ const e = localStorage.getItem(KEY.ENDED); return e?JSON.parse(e):null }
function setEnded(obj:any){ localStorage.setItem(KEY.ENDED, JSON.stringify(obj)) }

function digsLeft(){
  const last = localStorage.getItem(KEY.LAST_DIG_DAY)
  const extra = Number(localStorage.getItem(KEY.EXTRA) || 0)
  const t = today()
  if (last !== t){
    localStorage.setItem(KEY.LAST_DIG_DAY, t)
    return { free: DAILY_FREE_DIGS, extra }
  }
  const digs = loadDigs()
  const user = JSON.parse(localStorage.getItem(KEY.USER) || '{}')
  let used = 0
  for (const k in digs){
    const v = digs[k]
    if (v.ownerId===user.id && v.day===t) used++
  }
  return { free: Math.max(0, DAILY_FREE_DIGS - used), extra }
}

// ---- Server-ish API (localStorage-backed) ----
const api = {
  async window(ox:number,oy:number,w:number,h:number){
    const digs = loadDigs(), arr:any[] = []
    for (const k in digs){
      const [x,y] = k.split(',').map(Number)
      if (x>=ox && x<ox+w && y>=oy && y<oy+h){
        arr.push({ x, y, ...digs[k] })
      }
    }
    return arr
  },
  async dig(x:number,y:number){
    if (getEnded()) return { ok:false, reason:'Game over' }
    const user = getUser()
    const digs = loadDigs()
    const key = `${x},${y}`
    if (digs[key]) return { ok:false, reason:'Already dug' }
    const allowance = digsLeft()
    if (allowance.free<=0 && allowance.extra<=0) return { ok:false, reason:'No digs left today' }
    const v = { ownerId:user.id, initials:user.initials, ts:Date.now(), day:today() }
    digs[key] = v
    saveDigs(digs)
    if (allowance.free<=0 && allowance.extra>0) localStorage.setItem(KEY.EXTRA, String(allowance.extra-1))
    const t = getTreasure()
    const found = (x===t.x && y===t.y)
    if (found) setEnded({ winnerId:user.id, x, y, ts:Date.now() })
    return { ok:true, found }
  },
}

// ---- Dunes height ----
function duneHeight(x:number,z:number){
  const a = Math.sin(x*0.06)*0.6 + Math.cos(z*0.05)*0.6
  const b = Math.sin((x+z)*0.025)*0.4 + Math.cos((x-z)*0.018)*0.35
  return (a+b)*0.6
}

// ---- Visual helpers ----
function Flag({ position }:{position:[number,number,number]}){
  return (
    <group position={position}>
      <mesh position={[0,0.2,0]}><cylinderGeometry args={[0.03,0.03,0.4,8]}/><meshStandardMaterial color={'#b0a38a'} /></mesh>
      <mesh position={[0.12,0.38,0]} rotation-y={Math.PI/2}><planeGeometry args={[0.28,0.16]}/><meshStandardMaterial color={'#e53935'} side={THREE.DoubleSide}/></mesh>
    </group>
  )
}
function Chest({ position }:{position:[number,number,number]}){
  return (
    <group position={position}>
      <mesh position={[0,0.15,0]}><boxGeometry args={[0.5,0.3,0.3]}/><meshStandardMaterial color={'#8d6e63'} /></mesh>
      <mesh position={[0,0.32,0]}><boxGeometry args={[0.5,0.1,0.3]}/><meshStandardMaterial color={'#5d4037'} /></mesh>
      <mesh position={[0.23,0.18,0]}><boxGeometry args={[0.04,0.08,0.04]}/><meshStandardMaterial color={'#ffeb3b'} /></mesh>
    </group>
  )
}
function HoverArrow({ position }:{position:[number,number,number]}){
  const ref = useRef<THREE.Group>(null!)
  const { camera } = useThree()
  useFrame(()=>{ if(ref.current){ ref.current.rotation.set(0, camera.rotation.y, 0) } })
  return (
    <group ref={ref} position={position}>
      <mesh position={[0,0.25,0]}><cylinderGeometry args={[0.03,0.03,0.5,12]}/><meshStandardMaterial color={'#00e5ff'} roughness={0.6}/></mesh>
      <mesh position={[0,0.55,0]} rotation-x={Math.PI/2}><coneGeometry args={[0.12,0.24,16]}/><meshStandardMaterial color={'#00e5ff'} /></mesh>
    </group>
  )
}

// ---- Desert ----
function Desert({ ox, oy, digsInView }:{ox:number,oy:number,digsInView:any[]}){
  const sand = useTexture('/textures_desert_plus/sand.jpg')
  const sandN = useTexture('/textures_desert_plus/sand_normal.jpg')
  const rock = useTexture('/textures_desert_plus/rock.jpg')
  const bush = useTexture('/textures_desert_plus/bush.png')
  const sky = useTexture('/textures_desert_plus/sky_warm.jpg')

  const { scene, gl } = useThree()
  useEffect(()=>{
    (sky as any).mapping = THREE.EquirectangularReflectionMapping
    scene.background = sky as any
    gl.toneMapping = THREE.ACESFilmicToneMapping
    gl.toneMappingExposure = 1.0
  },[scene, gl, sky])

  ;[sand,sandN,rock].forEach((t:any)=>{ t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(20,20) })

  const groundGeom = useMemo(()=>{
    const size=200, seg=200
    const g = new THREE.PlaneGeometry(size, size, seg, seg)
    const pos = g.attributes.position as THREE.BufferAttribute
    for(let i=0;i<pos.count;i++){
      const x = pos.getX(i), z = pos.getY(i)
      pos.setZ(i, duneHeight(x, z))
    }
    pos.needsUpdate = true
    g.computeVertexNormals()
    return g
  },[])

  const rockGeom = useMemo(()=> new THREE.DodecahedronGeometry(0.5,0), [])
  const bushGeom = useMemo(()=> new THREE.PlaneGeometry(1,1), [])

  const groundMat = useMemo(()=> new THREE.MeshStandardMaterial({ map:sand as any, normalMap:sandN as any, roughness:1 }), [sand,sandN])
  const rockMat = useMemo(()=> new THREE.MeshStandardMaterial({ map:rock as any, roughness:0.9 }), [rock])
  const bushMat = useMemo(()=> new THREE.MeshBasicMaterial({ map:bush as any, transparent:true, depthWrite:false }), [bush])

  const rocks = useRef<THREE.InstancedMesh>(null!)
  const bushes = useRef<THREE.InstancedMesh>(null!)

  useEffect(()=>{
    const dummy = new THREE.Object3D()
    if (rocks.current){
      let i=0
      for (let k=0;k<800;k++){
        const x=(Math.random()-0.5)*180, z=(Math.random()-0.5)*180
        const y = duneHeight(x,z)
        dummy.position.set(x,y+0.1,z)
        dummy.rotation.set(0,Math.random()*Math.PI*2,0)
        const s=0.4+Math.random()*0.8; dummy.scale.set(s,s,s)
        dummy.updateMatrix(); rocks.current.setMatrixAt(i++, dummy.matrix)
      }
      rocks.current.count = 800; rocks.current.instanceMatrix.needsUpdate=true
    }
    if (bushes.current){
      let i=0
      for (let k=0;k<600;k++){
        const x=(Math.random()-0.5)*180, z=(Math.random()-0.5)*180
        const y = duneHeight(x,z)
        dummy.position.set(x,y+0.05,z)
        dummy.rotation.set(0,Math.random()*Math.PI*2,0)
        const s=1+Math.random()*1.5; dummy.scale.set(s,s,1)
        dummy.updateMatrix(); bushes.current.setMatrixAt(i++, dummy.matrix)
      }
      bushes.current.count = 600; bushes.current.instanceMatrix.needsUpdate=true
    }
  },[])

  // mile markers
  const markers = useMemo(()=>{
    const arr:JSX.Element[] = []
    for (let z=-90; z<=90; z+=10){
      const y1 = duneHeight(-2.5, z), y2 = duneHeight(2.5, z)
      arr.push(<mesh key={'ml'+z} position={[-2.5, y1+0.6, z]}><boxGeometry args={[0.2,1.2,0.2]}/><meshStandardMaterial color={'#c4b38a'} /></mesh>)
      arr.push(<mesh key={'mr'+z} position={[ 2.5, y2+0.6, z]}><boxGeometry args={[0.2,1.2,0.2]}/><meshStandardMaterial color={'#c4b38a'} /></mesh>)
    }
    return arr
  },[])

  return (
    <group>
      <mesh rotation-x={-Math.PI/2} geometry={groundGeom} material={groundMat} receiveShadow castShadow />
      <instancedMesh ref={rocks} args={[rockGeom, rockMat, 800]} castShadow receiveShadow />
      <instancedMesh ref={bushes} args={[bushGeom, bushMat, 600]} rotation-y={Math.PI/4} />
      {markers}
      {digsInView.map(d => (
        <React.Fragment key={`${d.x},${d.y}`}>
          <Flag position={[(d.x - ox - VIEW_W/2), duneHeight(d.x - ox - VIEW_W/2, d.y - oy - VIEW_H/2)+0.05, (d.y - oy - VIEW_H/2)]} />
          <Html center transform distanceFactor={25}
            position={[(d.x - ox - VIEW_W/2), duneHeight(d.x - ox - VIEW_W/2, d.y - oy - VIEW_H/2)+0.5, (d.y - oy - VIEW_H/2)]}>
            <div className="text-[10px] md:text-xs tracking-widest font-bold text-amber-200/90" style={{ textShadow:'0 0 6px rgba(255,220,120,0.8)' }}>{d.initials}</div>
          </Html>
        </React.Fragment>
      ))}
    </group>
  )
}

// ---- Controls ----
function Controls({ mode, setHovered, setOff, playerPos }:{mode:'fp'|'tp', setHovered:(v:any)=>void, setOff:(fn:(o:{ox:number,oy:number})=>{ox:number,oy:number})=>void, playerPos:THREE.Vector3}){
  const { camera } = useThree()
  const keys = useRef<{[k:string]:boolean}>({})
  const vel = useRef(new THREE.Vector3())
  const dir = useRef(new THREE.Vector3())
  const ray = useMemo(()=>new THREE.Raycaster(),[])
  const plane = useMemo(()=> new THREE.Plane(new THREE.Vector3(0,1,0), 0), [])

  useEffect(()=>{
    camera.position.set(0, mode==='fp'?1.7:2.0, 6)
    camera.lookAt(0,1.6,0)
  },[camera, mode])

  useEffect(()=>{
    const down = (e:KeyboardEvent)=>{ keys.current[e.key.toLowerCase()] = true }
    const up = (e:KeyboardEvent)=>{ keys.current[e.key.toLowerCase()] = false }
    window.addEventListener('keydown',down); window.addEventListener('keyup',up)
    return ()=>{ window.removeEventListener('keydown',down); window.removeEventListener('keyup',up) }
  }, [])

  useFrame((state, dt)=>{
    const delta = Math.min(0.05, dt)
    dir.current.set(0,0,0)
    if (keys.current['w']) dir.current.z -= 1
    if (keys.current['s']) dir.current.z += 1
    if (keys.current['a']) dir.current.x -= 1
    if (keys.current['d']) dir.current.x += 1
    dir.current.normalize()
    const speed = keys.current['shift'] ? 16 : 8
    vel.current.copy(dir.current).applyQuaternion(camera.quaternion).multiplyScalar(speed*delta)

    camera.position.add(new THREE.Vector3(vel.current.x, 0, vel.current.z))
    const y = duneHeight(camera.position.x, camera.position.z) + (mode==='fp'?1.7:2.2)
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, y, 0.6)

    // update playerPos & "follow" camera for 3rd-person
    playerPos.set(camera.position.x, 0, camera.position.z)
    if (mode==='tp'){
      const back = new THREE.Vector3(0,0,-3).applyQuaternion(camera.quaternion)
      const look = new THREE.Vector3().copy(playerPos)
      camera.position.copy(playerPos).add(new THREE.Vector3(0,1.6,0)).add(back)
      camera.lookAt(look.x, duneHeight(look.x, look.z)+1.6, look.z)
    }

    // Update view window offsets for storage mapping
    setOff(o=>{
      const nx = clamp(Math.floor(o.ox + vel.current.x), 0, WORLD_W - VIEW_W)
      const ny = clamp(Math.floor(o.oy + vel.current.z), 0, WORLD_H - VIEW_H)
      return (nx!==o.ox || ny!==o.oy) ? {ox:nx, oy:ny} : o
    })

    // Hovered position under crosshair
    ray.setFromCamera(new THREE.Vector2(0,0), camera as any)
    const p = new THREE.Vector3()
    if (ray.ray.intersectPlane(plane, p)){
      const gx = Math.round(p.x + VIEW_W/2)
      const gy = Math.round(p.z + VIEW_H/2)
      if (gx>=0 && gx<VIEW_W && gy>=0 && gy<VIEW_H){
        setHovered({ x: gx, y: gy, worldX: p.x, worldY: p.z })
      } else setHovered(null as any)
    }
  })

  return null
}

// ---- Minimap ----
function MiniMap({ ox, oy, digs, player }:{ox:number,oy:number,digs:any[],player:{x:number,y:number}}){
  const ref = useRef<HTMLCanvasElement>(null!)
  useEffect(()=>{
    const c = ref.current; if (!c) return
    const ctx = c.getContext('2d')!
    const w=c.width, h=c.height
    ctx.clearRect(0,0,w,h)
    ctx.fillStyle = '#b8925c'; ctx.fillRect(0,0,w,h)
    // dug cells
    ctx.fillStyle = 'rgba(0,0,0,0.4)'
    digs.forEach((d:any)=>{
      const x = (d.x - ox) / VIEW_W * w
      const y = (d.y - oy) / VIEW_H * h
      const cs = Math.max(2, w/VIEW_W)
      ctx.fillRect(x, y, cs, cs)
    })
    // player
    ctx.fillStyle = '#00e5ff'
    const px = (player.x - ox) / VIEW_W * w
    const py = (player.y - oy) / VIEW_H * h
    ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI*2); ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.strokeRect(0,0,w,h)
  },[ox,oy,digs,player])
  return <canvas ref={ref} width={160} height={160} className="rounded-lg border border-white/10" />
}

// ---- Main App ----
export default function App(){
  const [user, setUser] = useState<any>(null)
  const [{ox,oy}, setOff] = useState(getOffset())
  const [hovered, setHovered] = useState<{x:number,y:number,worldX:number,worldY:number}|null>(null)
  const [digs, setDigs] = useState<any[]>([])
  const [mode, setMode] = useState<'fp'|'tp'>('fp')
  const [showMap, setShowMap] = useState(false)
  const ended = getEnded()
  const playerPos = useRef(new THREE.Vector3(0,0,0))

  const [free, setFree] = useState(DAILY_FREE_DIGS)
  const [extra, setExtra] = useState(0)

  useEffect(()=>{
    setUser(getUser())
    const a = digsLeft(); setFree(a.free); setExtra(a.extra)
  },[])

  useEffect(()=>{
    let mounted = true
    api.window(ox,oy,VIEW_W,VIEW_H).then(res=>{ if(mounted) setDigs(res) })
    setOffset({ox,oy})
    return ()=>{ mounted=false }
  },[ox,oy])

  const handleDig = async()=>{
    if (!hovered) return
    const wx = ox + hovered.x, wy = oy + hovered.y
    const res = await api.dig(wx, wy)
    if (!res.ok){ alert(res.reason); return }
    const a = digsLeft(); setFree(a.free); setExtra(a.extra)
    if (res.found){
      alert('🎉 Treasure found! The game is over.')
    }
    const win = await api.window(ox,oy,VIEW_W,VIEW_H); setDigs(win)
  }

  return (
    <div className="min-h-screen w-full" style={{ background:'#0b0f14', color:'white' }}>
      <header className="flex items-center justify-between p-4 md:p-6 border-b border-amber-500/20 sticky top-0 z-20" style={{ background:'#0b0f14CC', backdropFilter:'blur(6px)' }}>
        <h1 className="text-xl md:text-2xl font-extrabold tracking-tight">CYBER HUNT<span className="text-amber-400">.</span></h1>
        <div className="flex items-center gap-2">
          <button className="rounded px-3 py-2 bg-white/10 hover:bg-white/20" onClick={(e)=>{e.stopPropagation(); setMode(m=>m==='fp'?'tp':'fp')}}>{mode==='fp'?'3rd person':'1st person'}</button>
          <button className="rounded px-3 py-2 bg-white/10 hover:bg-white/20" onClick={(e)=>{e.stopPropagation(); setShowMap(s=>!s)}}>{showMap?'Hide Map':'Map'}</button>
        </div>
      </header>

      <main className="grid md:grid-cols-[320px_1fr] gap-4 md:gap-6 p-4 md:p-6">
        {/* Sidebar */}
        <div className="bg-[#0e141c] border border-amber-500/20 rounded-2xl p-4 md:p-6 select-none">
          <div className="space-y-4">
            <div>
              <div className="text-sm text-white/60">Player</div>
              <div className="text-lg font-semibold">{user?.initials || 'YOU'}</div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="rounded-xl bg-amber-500/10 p-3">
                <div className="text-2xl font-bold text-amber-300">{free}</div>
                <div className="text-xs text-white/60">Free digs today</div>
              </div>
              <div className="rounded-xl bg-fuchsia-500/10 p-3">
                <div className="text-2xl font-bold text-fuchsia-300">{extra}</div>
                <div className="text-xs text-white/60">Extra digs</div>
              </div>
            </div>
            <div className="text-sm text-white/70">
              Click inside the desert once to enable look controls.<br/>
              Use <b>W/A/S/D</b> to walk, <b>Shift</b> to sprint.<br/>
              <b>Click the desert</b> to dig at the highlighted ring/arrow.
            </div>

            <div className="pt-4 border-t border-white/10">
              <div className="text-xs text-white/50 mb-2">Mini Map (current window)</div>
              <MiniMap
                ox={ox} oy={oy} digs={digs}
                player={{ x: ox + VIEW_W/2 + playerPos.current.x, y: oy + VIEW_H/2 + playerPos.current.z }}
              />
            </div>

            <div className="text-xs text-white/40 pt-2">
              {ended ? <div className="text-amber-300">Game ended. Treasure at ({ended.x}, {ended.y}).</div> : <div>Find the cache. First exact hit wins.</div>}
            </div>
          </div>
        </div>

        {/* 3D View */}
        <div className="relative rounded-2xl overflow-hidden border border-amber-500/20" style={{ height:'70vh' }}>
          <Canvas
            shadows
            camera={{ fov:70 }}
            onPointerDown={(e)=>{ e.stopPropagation(); handleDig() }}
          >
            <hemisphereLight skyColor={'#ffe'} groundColor={'#a86'} intensity={0.7} />
            <directionalLight position={[18, 28, -12]} intensity={1.2} color={'#ffcf8a'} castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048} />

            <Controls mode={mode} setHovered={setHovered} setOff={setOff} playerPos={playerPos.current} />
            <Desert ox={ox} oy={oy} digsInView={digs} />

            {/* Hover indicator */}
            {hovered && (
              <group>
                <mesh rotation-x={-Math.PI/2} position={[hovered.worldX, duneHeight(hovered.worldX, hovered.worldY)+0.03, hovered.worldY]}>
                  <ringGeometry args={[0.35,0.42,32]} />
                  <meshBasicMaterial color={'#00e5ff'} transparent opacity={0.85} />
                </mesh>
                <HoverArrow position={[hovered.worldX, duneHeight(hovered.worldX, hovered.worldY)+0.65, hovered.worldY]} />
              </group>
            )}

            {/* Show chest if game ended */}
            {ended && (
              <Chest position={[ended.x - ox - VIEW_W/2, duneHeight(ended.x - ox - VIEW_W/2, ended.y - oy - VIEW_H/2)+0.1, ended.y - oy - VIEW_H/2]} />
            )}

            {/* Lock after first click on canvas */}
            <PointerLockControls />
            <Html center><div style={{ width:10, height:10, borderRadius:9999, border:'2px solid rgba(255,255,255,0.9)' }} /></Html>
          </Canvas>

          {/* World map overlay */}
          {showMap && (
            <div className="absolute inset-0 bg-black/70 backdrop-blur p-4" onPointerDown={(e)=>e.stopPropagation()}>
              <div className="bg-black/40 rounded-xl p-4 h-full flex flex-col">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-white/80 font-semibold">World Map — current window</div>
                  <button className="px-3 py-1 rounded bg-white/10 hover:bg-white/20" onClick={(e)=>{e.stopPropagation(); setShowMap(false)}}>Close</button>
                </div>
                <div className="flex-1 grid place-items-center">
                  <MiniMap
                    ox={ox} oy={oy} digs={digs}
                    player={{ x: ox + VIEW_W/2 + playerPos.current.x, y: oy + VIEW_H/2 + playerPos.current.z }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
