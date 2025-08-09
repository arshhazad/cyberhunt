
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { Html, PointerLockControls, useTexture } from '@react-three/drei'
import * as THREE from 'three'

const WORLD_W = 3163
const WORLD_H = 3162
const VIEW_W = 160
const VIEW_H = 160
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

// ---------- Street Scene ----------

function Street({ ox, oy, digsInView }:{ox:number,oy:number,digsInView:any[]}){
  const asphalt = useTexture('/textures_street_v2/asphalt.jpg')
  const sidewalk = useTexture('/textures_street_v2/sidewalk.jpg')
  const curb = useTexture('/textures_street_v2/curb.jpg')
  const facade = useTexture('/textures_street_v2/facade.jpg')
  const lanes = useTexture('/textures_street_v2/lanes.png')
  const sky = useTexture('/textures_street_v2/sky.jpg')

  const { scene, gl } = useThree()
  useEffect(()=>{
    const tex = sky as THREE.Texture
    tex.mapping = THREE.EquirectangularReflectionMapping
    scene.background = tex
    gl.toneMapping = THREE.ACESFilmicToneMapping
    gl.toneMappingExposure = 1.0
    gl.shadowMap.enabled = true
  },[scene, gl, sky])

  ;[asphalt, sidewalk, facade].forEach(t=>{ t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6,6); (t as any).anisotropy = 8 })

  const plane = useMemo(()=> new THREE.PlaneGeometry(1,1), [])
  const longPlane = useMemo(()=> new THREE.PlaneGeometry(1,0.2), [])
  const curbGeom = useMemo(()=> new THREE.BoxGeometry(1,0.15,0.3), [])
  const bldgGeom = useMemo(()=> new THREE.BoxGeometry(1.5, 6, 1.2), [])
  const palmTrunk = useMemo(()=> new THREE.CylinderGeometry(0.06, 0.09, 3, 8), [])
  const palmLeaf = useMemo(()=> new THREE.BoxGeometry(0.05, 0.6, 0.2), [])

  const roadMat = useMemo(()=> new THREE.MeshStandardMaterial({ map: asphalt, roughness:0.95, metalness:0.02 }), [asphalt])
  const walkMat = useMemo(()=> new THREE.MeshStandardMaterial({ map: sidewalk, roughness:1, metalness:0 }), [sidewalk])
  const curbMat = useMemo(()=> new THREE.MeshStandardMaterial({ map: curb, roughness:1, metalness:0 }), [curb])
  const lineMat = useMemo(()=> new THREE.MeshBasicMaterial({ map: lanes, transparent:true, opacity:0.95 }), [lanes])
  const bldgMat = useMemo(()=> new THREE.MeshStandardMaterial({ map: facade, roughness:0.7, metalness:0.1, emissive:'#171821', emissiveIntensity:0.25 }), [facade])
  const palmMat = useMemo(()=> new THREE.MeshStandardMaterial({ color:'#3a2d1f' }), [])
  const leafMat = useMemo(()=> new THREE.MeshStandardMaterial({ color:'#1faa59' }), [])

  const roads = useRef<THREE.InstancedMesh>(null!)
  const walksL = useRef<THREE.InstancedMesh>(null!)
  const walksR = useRef<THREE.InstancedMesh>(null!)
  const lines = useRef<THREE.InstancedMesh>(null!)
  const curbsL = useRef<THREE.InstancedMesh>(null!)
  const curbsR = useRef<THREE.InstancedMesh>(null!)
  const bldgsL = useRef<THREE.InstancedMesh>(null!)
  const bldgsR = useRef<THREE.InstancedMesh>(null!)
  const palmsL = useRef<THREE.InstancedMesh>(null!)
  const palmsR = useRef<THREE.InstancedMesh>(null!)
  const leavesL = useRef<THREE.InstancedMesh>(null!)
  const leavesR = useRef<THREE.InstancedMesh>(null!)

  const cells = VIEW_W*VIEW_H
  useEffect(()=>{
    ;[roads,walksL,walksR,lines,curbsL,curbsR,bldgsL,bldgsR,palmsL,palmsR,leavesL,leavesR].forEach(m=>{ if(m.current) m.current.count = cells })
  },[])

  useEffect(()=>{
    const dummy = new THREE.Object3D()
    let ri=0, wl=0, wr=0, li=0, cl=0, cr=0, bl=0, br=0, pl=0, pr=0, ll=0, lr=0

    // We render a single long street along Z, centered X=0, with sidewalks at X=±2.5, buildings at ±4.2
    for (let yy=0; yy<VIEW_H; yy++){
      for (let xx=0; xx<VIEW_W; xx++){
        const z = (yy - VIEW_H/2)
        const x = 0 // road center
        // road tile
        dummy.position.set(x, 0, z)
        dummy.rotation.set(-Math.PI/2,0,0); dummy.scale.set(6,1,1)
        dummy.updateMatrix()
        roads.current.setMatrixAt(ri++, dummy.matrix)

        // lane markings
        dummy.position.set(x, 0.002, z)
        dummy.rotation.set(-Math.PI/2,0,0); dummy.scale.set(6,1,1)
        dummy.updateMatrix()
        lines.current.setMatrixAt(li++, dummy.matrix)

        // sidewalks L/R
        dummy.rotation.set(-Math.PI/2,0,0); dummy.scale.set(2,1,1)
        dummy.position.set(-4, 0.001, z)
        dummy.updateMatrix(); walksL.current.setMatrixAt(wl++, dummy.matrix)
        dummy.position.set( 4, 0.001, z)
        dummy.updateMatrix(); walksR.current.setMatrixAt(wr++, dummy.matrix)

        // curbs
        dummy.rotation.set(0,0,0); dummy.scale.set(2,1,1)
        dummy.position.set(-3, 0.075, z)
        dummy.updateMatrix(); curbsL.current.setMatrixAt(cl++, dummy.matrix)
        dummy.position.set( 3, 0.075, z)
        dummy.updateMatrix(); curbsR.current.setMatrixAt(cr++, dummy.matrix)

        // buildings every ~6 units
        if (yy % 6 === 0){
          const hL = 5 + seeded(xx,yy)*8
          dummy.position.set(-5.5, hL/2, z)
          dummy.rotation.set(0, seeded(xx+7,yy+3)*Math.PI*2, 0)
          dummy.scale.set(1.5, hL, 1.2)
          dummy.updateMatrix(); bldgsL.current.setMatrixAt(bl++, dummy.matrix)

          const hR = 5 + seeded(xx+13,yy+11)*8
          dummy.position.set(5.5, hR/2, z)
          dummy.rotation.set(0, seeded(xx+17,yy+5)*Math.PI*2, 0)
          dummy.scale.set(1.5, hR, 1.2)
          dummy.updateMatrix(); bldgsR.current.setMatrixAt(br++, dummy.matrix)
        }

        // palms every ~12 units
        if (yy % 12 === 0){
          // left
          dummy.position.set(-4.8, 1.5, z)
          dummy.rotation.set(0,0,0)
          dummy.scale.set(1,1,1)
          dummy.updateMatrix(); palmsL.current.setMatrixAt(pl++, dummy.matrix)
          for (let k=0;k<6;k++){
            const leaf = new THREE.Object3D()
            leaf.position.set(-4.8, 3.0, z)
            leaf.rotation.set(Math.PI/2.8, (k/6)*Math.PI*2, 0)
            leaf.scale.set(1,1,1)
            leaf.updateMatrix(); leavesL.current.setMatrixAt(ll++, leaf.matrix)
          }
          // right
          dummy.position.set(4.8, 1.5, z); dummy.updateMatrix(); palmsR.current.setMatrixAt(pr++, dummy.matrix)
          for (let k=0;k<6;k++){
            const leaf = new THREE.Object3D()
            leaf.position.set(4.8, 3.0, z)
            leaf.rotation.set(Math.PI/2.8, (k/6)*Math.PI*2, 0)
            leaf.scale.set(1,1,1)
            leaf.updateMatrix(); leavesR.current.setMatrixAt(lr++, leaf.matrix)
          }
        }
      }
    }

    roads.current.count = ri
    walksL.current.count = wl; walksR.current.count = wr
    lines.current.count = li
    curbsL.current.count = cl; curbsR.current.count = cr
    bldgsL.current.count = bl; bldgsR.current.count = br
    palmsL.current.count = pl; palmsR.current.count = pr
    leavesL.current.count = ll; leavesR.current.count = lr

    ;[roads,walksL,walksR,lines,curbsL,curbsR,bldgsL,bldgsR,palmsL,palmsR,leavesL,leavesR].forEach(r=>{
      r.current.instanceMatrix.needsUpdate = true
    })
  },[ox,oy])

  return (
    <group>
      <instancedMesh ref={roads} args={[plane, roadMat, VIEW_W*VIEW_H]} receiveShadow />
      <instancedMesh ref={lines} args={[longPlane, lineMat, VIEW_W*VIEW_H]} />
      <instancedMesh ref={walksL} args={[plane, walkMat, VIEW_W*VIEW_H]} receiveShadow />
      <instancedMesh ref={walksR} args={[plane, walkMat, VIEW_W*VIEW_H]} receiveShadow />
      <instancedMesh ref={curbsL} args={[curbGeom, curbMat, VIEW_W*VIEW_H]} receiveShadow />
      <instancedMesh ref={curbsR} args={[curbGeom, curbMat, VIEW_W*VIEW_H]} receiveShadow />
      <instancedMesh ref={bldgsL} args={[bldgGeom, bldgMat, VIEW_W*VIEW_H]} castShadow receiveShadow />
      <instancedMesh ref={bldgsR} args={[bldgGeom, bldgMat, VIEW_W*VIEW_H]} castShadow receiveShadow />
      <instancedMesh ref={palmsL} args={[palmTrunk, palmMat, VIEW_W*VIEW_H]} castShadow receiveShadow />
      <instancedMesh ref={palmsR} args={[palmTrunk, palmMat, VIEW_W*VIEW_H]} castShadow receiveShadow />
      <instancedMesh ref={leavesL} args={[palmLeaf, leafMat, VIEW_W*VIEW_H]} receiveShadow />
      <instancedMesh ref={leavesR} args={[palmLeaf, leafMat, VIEW_W*VIEW_H]} receiveShadow />
      {digsInView.map(d => (
        <Html key={`${d.x},${d.y}`} center transform distanceFactor={20}
          position={[(0), 0.05, (d.y - oy - VIEW_H/2)]}>
          <div className="text-[10px] md:text-xs tracking-widest font-bold text-cyan-300/90"
            style={{ textShadow: '0 0 6px #00fff0' }}>{d.initials}</div>
        </Html>
      ))}
    </group>
  )
}

function StreetControls({ setHovered, ox, oy }:{ setHovered:(v:any)=>void, ox:number, oy:number }){
  const { camera, gl } = useThree()
  const raycaster = useMemo(()=>new THREE.Raycaster(),[])
  const plane = useMemo(()=>new THREE.Plane(new THREE.Vector3(0,1,0), 0),[])
  const keys = useRef<{[k:string]:boolean}>({})
  const v = useRef(new THREE.Vector3())
  const dir = useRef(new THREE.Vector3())

  useEffect(()=>{
    camera.position.set(0, 1.75, 8)
    camera.lookAt(0,1.7,0)
    gl.shadowMap.enabled = True
  },[camera, gl])

  useEffect(()=>{
    const down = (e:KeyboardEvent)=>{ keys.current[e.key.toLowerCase()] = true }
    const up = (e:KeyboardEvent)=>{ keys.current[e.key.toLowerCase()] = false }
    window.addEventListener('keydown', down); window.addEventListener('keyup', up)
    return ()=>{ window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [])

  useThree(({ clock })=>{
    const dt = Math.min(0.05, clock.getDelta())
    dir.current.set(0,0,0)
    if (keys.current['w']) dir.current.z -= 1
    if (keys.current['s']) dir.current.z += 1
    if (keys.current['a']) dir.current.x -= 1
    if (keys.current['d']) dir.current.x += 1
    dir.current.normalize()
    v.current.copy(dir.current).applyQuaternion(camera.quaternion).multiplyScalar(6*dt)
    camera.position.add(new THREE.Vector3(v.current.x, 0, v.current.z))
  })

  useEffect(()=>{
    const onTick = ()=>{
      raycaster.setFromCamera(new THREE.Vector2(0,0), camera as any)
      const p = new THREE.Vector3()
      raycaster.ray.intersectPlane(plane, p)
      const gx = Math.round(p.x + VIEW_W/2) // not used for X (street aligned), but keep mapping
      const gy = Math.round(p.z + VIEW_H/2)
      const wx = clamp(ox + gx, 0, WORLD_W-1)
      const wy = clamp(oy + gy, 0, WORLD_H-1)
      if (gy>=0 && gy<VIEW_H) setHovered({ x: wx, y: wy })
      else setHovered(null)
    }
    const id = setInterval(onTick, 50); return ()=>clearInterval(id)
  }, [camera, ox, oy, setHovered, raycaster, plane])

  return <PointerLockControls selector="#enter-street" />
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
        <button id="enter-street" className="rounded px-3 py-2 bg-cyan-600 hover:bg-cyan-500">Click to enter Street View</button>
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
            <div className="text-sm text-white/70">Click the button above to lock the mouse. Use <b>W/A/S/D</b> to walk. Click <b>DIG</b> to excavate the tile under the crosshair.</div>
            <button onClick={handleDig} className="mt-2 bg-cyan-600 hover:bg-cyan-500 w-full rounded-lg px-3 py-2 font-semibold">DIG</button>
            <div className="text-xs text-white/40 pt-2">
              {ended ? <div className="text-fuchsia-300">Game ended. Treasure found at ({ended.x}, {ended.y}).</div> : <div>Find the hidden cache. First to hit the exact square wins. 🏴‍☠️</div>}
            </div>
          </div>
        </div>

        <div className="relative rounded-2xl overflow-hidden border border-cyan-500/20" style={{ height: '70vh' }}>
          <Canvas shadows camera={{ fov: 65 }}>
            <hemisphereLight skyColor={'#9bb'} groundColor={'#223'} intensity={0.6} />
            <directionalLight position={[12, 20, 6]} intensity={1.4} castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048} />

            <StreetControls setHovered={setHovered} ox={ox} oy={oy} />
            <Street ox={ox} oy={oy} digsInView={digs} />

            <Html center>
              <div style={{ width: 10, height: 10, borderRadius: 9999, border: '2px solid rgba(255,255,255,0.9)' }}></div>
            </Html>
          </Canvas>
        </div>
      </main>
    </div>
  )
}
