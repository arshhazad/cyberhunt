
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { Html, PointerLockControls, useTexture } from '@react-three/drei'
import * as THREE from 'three'

/**
 * Cyber Hunt — Street Pack (static city, street-level)
 * - First-person street view with WASD (press click to lock pointer)
 * - Sunlight + shadows + ACES tone mapping
 * - Road with double yellow center + sidewalks
 * - Rows of textured buildings + parked cars
 * - Click to DIG a 1x1 tile under the crosshair
 * - Treasure/dig logic preserved
 */

const WORLD_W = 3163
const WORLD_H = 3162
const VIEW_W = 120   // smaller viewport at street level for perf
const VIEW_H = 120
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

// --- Street City Scene ---

function City({ ox, oy, digsInView }:{ox:number,oy:number,digsInView:any[]}){
  const asphalt = useTexture('/textures_street/asphalt.jpg')
  const sidewalk = useTexture('/textures_street/sidewalk.jpg')
  const facade = useTexture('/textures_street/facade.jpg')
  const doubleYellow = useTexture('/textures_street/double_yellow.png')

  const roadMat = useMemo(()=> new THREE.MeshStandardMaterial({ map: asphalt, roughness:0.95, metalness:0.05 }), [asphalt])
  const walkMat = useMemo(()=> new THREE.MeshStandardMaterial({ map: sidewalk, roughness:1, metalness:0 }), [sidewalk])
  const lineMat = useMemo(()=> new THREE.MeshBasicMaterial({ map: doubleYellow, transparent:true, opacity:0.85 }), [doubleYellow])
  const bldgMat = useMemo(()=> new THREE.MeshStandardMaterial({ map: facade, emissive:new THREE.Color('#181820'), emissiveIntensity:0.25, roughness:0.8 }), [facade])
  const carMat = useMemo(()=> new THREE.MeshStandardMaterial({ color:'#c62828', roughness:0.5, metalness:0.5, emissive:'#220000', emissiveIntensity:0.1 }), [])

  const plane = useMemo(()=> new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE), [])
  const lineGeom = useMemo(()=> new THREE.PlaneGeometry(TILE_SIZE, 0.3), [])
  const bldgGeom = useMemo(()=> new THREE.BoxGeometry(1.2, 4, 1.2), [])
  const carGeom = useMemo(()=> new THREE.BoxGeometry(1.2, 0.5, 0.6), [])

  const roads = useRef<THREE.InstancedMesh>(null!)
  const walks = useRef<THREE.InstancedMesh>(null!)
  const linesH = useRef<THREE.InstancedMesh>(null!)
  const linesV = useRef<THREE.InstancedMesh>(null!)
  const bldgs = useRef<THREE.InstancedMesh>(null!)
  const cars = useRef<THREE.InstancedMesh>(null!)

  useEffect(()=>{
    const cells = VIEW_W*VIEW_H
    ;[roads,walks,linesH,linesV,bldgs,cars].forEach(r=>{ if(r.current) r.current.count = cells })
  },[])

  useEffect(()=>{
    if (!roads.current || !walks.current || !linesH.current || !linesV.current || !bldgs.current || !cars.current) return
    const dummy = new THREE.Object3D()
    let ri=0, wi=0, lhi=0, lvi=0, bi=0, ci=0

    for (let yy=0; yy<VIEW_H; yy++){
      for (let xx=0; xx<VIEW_W; xx++){
        const wx = ox + xx, wy = oy + yy
        const x = (xx - VIEW_W/2)
        const z = (yy - VIEW_H/2)

        const roadRow = (wy % 12 === 0)
        const roadCol = (wx % 12 === 0)
        const isRoad = roadRow || roadCol

        if (isRoad){
          dummy.position.set(x, 0, z)
          dummy.rotation.set(-Math.PI/2,0,0)
          dummy.updateMatrix()
          roads.current.setMatrixAt(ri++, dummy.matrix)

          // center lines on roads (horizontal & vertical)
          if (roadRow){
            dummy.position.set(x, 0.002, z)
            dummy.updateMatrix()
            linesH.current.setMatrixAt(lhi++, dummy.matrix)
          }
          if (roadCol){
            dummy.position.set(x, 0.002, z)
            dummy.rotation.set(-Math.PI/2, Math.PI/2, 0)
            dummy.updateMatrix()
            linesV.current.setMatrixAt(lvi++, dummy.matrix)
            dummy.rotation.set(-Math.PI/2, 0, 0)
          }

          // parked car occasionally near curb
          if ((wx % 24 === 6) && (wy % 24 === 12)){
            dummy.position.set(x + 0.8, 0.3, z)
            dummy.rotation.set(0, Math.PI/2, 0)
            dummy.scale.set(1.2,0.5,0.6)
            dummy.updateMatrix()
            cars.current.setMatrixAt(ci++, dummy.matrix)
          }

        } else {
          // sidewalk
          dummy.position.set(x, 0, z)
          dummy.rotation.set(-Math.PI/2,0,0)
          dummy.updateMatrix()
          walks.current.setMatrixAt(wi++, dummy.matrix)

          // buildings along block edges (a few rows off roads)
          const nearRow = (wy % 12 === 2)
          const nearCol = (wx % 12 === 2)
          if ((nearRow && !roadCol) || (nearCol && !roadRow)){
            const h = 3 + seeded(wx, wy)*8
            dummy.position.set(x, h/2, z)
            dummy.rotation.set(0, (seeded(wx+2,wy+5))*Math.PI*2, 0)
            dummy.scale.set(1.2, h, 1.2)
            dummy.updateMatrix()
            bldgs.current.setMatrixAt(bi++, dummy.matrix)
          }
        }
      }
    }

    roads.current.count = ri
    walks.current.count = wi
    linesH.current.count = lhi
    linesV.current.count = lvi
    bldgs.current.count = bi
    cars.current.count = ci

    ;[roads,walks,linesH,linesV,bldgs,cars].forEach(r=>{
      r.current.instanceMatrix.needsUpdate = true
    })
  },[ox,oy])

  return (
    <group>
      <instancedMesh ref={walks} args={[plane, walkMat, VIEW_W*VIEW_H]} castShadow receiveShadow />
      <instancedMesh ref={roads} args={[plane, roadMat, VIEW_W*VIEW_H]} castShadow receiveShadow />
      <instancedMesh ref={linesH} args={[lineGeom, lineMat, VIEW_W*VIEW_H]} />
      <instancedMesh ref={linesV} args={[lineGeom, lineMat, VIEW_W*VIEW_H]} />
      <instancedMesh ref={bldgs} args={[bldgGeom, bldgMat, VIEW_W*VIEW_H]} castShadow receiveShadow />
      <instancedMesh ref={cars} args={[carGeom, carMat, VIEW_W*VIEW_H]} castShadow receiveShadow />
      {digsInView.map(d => (
        <Html key={`${d.x},${d.y}`} center transform distanceFactor={15}
          position={[(d.x - ox - VIEW_W/2), 0.05, (d.y - oy - VIEW_H/2)]}>
          <div className="text-[10px] md:text-xs tracking-widest font-bold text-cyan-300/90"
            style={{ textShadow: '0 0 6px #00fff0' }}>{d.initials}</div>
        </Html>
      ))}
    </group>
  )
}

// --- Controls: pointer lock + WASD movement ---
function StreetControls({ setHovered, ox, oy }:{ setHovered:(v:any)=>void, ox:number, oy:number }){
  const { camera, gl } = useThree()
  const velocity = useRef(new THREE.Vector3())
  const dir = useRef(new THREE.Vector3())
  const keys = useRef<{[k:string]:boolean}>({})
  const raycaster = useMemo(()=>new THREE.Raycaster(),[])
  const plane = useMemo(()=>new THREE.Plane(new THREE.Vector3(0,1,0), 0),[])

  useEffect(()=>{
    camera.position.set(0, 1.7, 6)
    camera.lookAt(0,1.6,0)
    gl.shadowMap.enabled = true
    gl.toneMapping = THREE.ACESFilmicToneMapping
    gl.toneMappingExposure = 1.0
  }, [camera, gl])

  useEffect(()=>{
    const down = (e:KeyboardEvent)=>{ keys.current[e.key.toLowerCase()] = true }
    const up = (e:KeyboardEvent)=>{ keys.current[e.key.toLowerCase()] = false }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return ()=>{ window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [])

  // simple loop
  useThree(({ clock })=>{
    const dt = Math.min(0.05, clock.getDelta())
    dir.current.set(0,0,0)
    if (keys.current['w']) dir.current.z -= 1
    if (keys.current['s']) dir.current.z += 1
    if (keys.current['a']) dir.current.x -= 1
    if (keys.current['d']) dir.current.x += 1
    dir.current.normalize()
    const speed = 6
    velocity.current.copy(dir.current).applyQuaternion(camera.quaternion).multiplyScalar(speed*dt)
    camera.position.add( new THREE.Vector3(velocity.current.x, 0, velocity.current.z) )
  })

  // update hovered from crosshair center
  useEffect(()=>{
    const onMove = ()=>{
      // cast from camera forward
      raycaster.setFromCamera(new THREE.Vector2(0,0), camera as any)
      const p = new THREE.Vector3()
      raycaster.ray.intersectPlane(plane, p)
      const gx = Math.round(p.x + VIEW_W/2)
      const gy = Math.round(p.z + VIEW_H/2)
      const wx = clamp(ox + gx, 0, WORLD_W-1)
      const wy = clamp(oy + gy, 0, WORLD_H-1)
      if (gx>=0 && gx<VIEW_W && gy>=0 && gy<VIEW_H) setHovered({ x: wx, y: wy })
      else setHovered(null)
    }
    const id = setInterval(onMove, 50)
    return ()=>clearInterval(id)
  }, [camera, ox, oy, setHovered, raycaster, plane])

  return <PointerLockControls selector="#street-enter" />
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
    let mounted=true
    api.fetchWindow(ox,oy,VIEW_W,VIEW_H).then(res=>mounted && setDigs(res))
    setOffset({ox,oy}); return ()=>{ mounted=false }
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
        <button id="street-enter" className="rounded px-3 py-2 bg-cyan-600 hover:bg-cyan-500">Click to enter Street View</button>
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
            <div className="text-sm text-white/70">Controls: Click the button above to lock the mouse. Use <b>W/A/S/D</b> to walk; click <b>Dig</b> to excavate the tile under the crosshair.</div>
            <div className="flex gap-2">
              <button onClick={handleDig} className="bg-cyan-600 hover:bg-cyan-500 w-full rounded-lg px-3 py-2 font-semibold">DIG</button>
            </div>
            <div className="text-xs text-white/40 pt-2">
              {ended ? <div className="text-fuchsia-300">Game ended. Treasure found at ({ended.x}, {ended.y}).</div> : <div>Find the hidden cache. First to hit the exact square wins. 🏴‍☠️</div>}
            </div>
          </div>
        </div>

        <div className="relative rounded-2xl overflow-hidden border border-cyan-500/20" style={{ height: '70vh' }}>
          <Canvas shadows camera={{ fov: 60 }}>
            <directionalLight position={[20, 30, 10]} intensity={1.2} castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048} />
            <hemisphereLight skyColor={'#88a'} groundColor={'#223'} intensity={0.5} />

            <StreetControls setHovered={setHovered} ox={ox} oy={oy} />
            <City ox={ox} oy={oy} digsInView={digs} />

            {/* crosshair */}
            <Html center>
              <div style={{ width: 12, height: 12, borderRadius: 9999, border: '2px solid rgba(255,255,255,0.8)' }}></div>
            </Html>
          </Canvas>
        </div>
      </main>
    </div>
  )
}
