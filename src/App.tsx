
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { Html, PointerLockControls, useTexture } from '@react-three/drei'
import * as THREE from 'three'
/** Desert Pack Plus
 * - Golden hour lighting + warm sky
 * - Dust particles
 * - Subtle heat-haze shimmer (post + noise)
 * - Stick figure player (toggle 1st/3rd-person)
 * - Mobile controls (Move / Left / Right)
 * - Highway distance markers
 * - Minimap with dug cells + player position
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

// --- Scene helpers
function duneHeight(x:number, z:number){
  const f1 = Math.sin(x*0.06) * 0.6 + Math.cos(z*0.05) * 0.6
  const f2 = Math.sin((x+z)*0.025) * 0.4 + Math.cos((x-z)*0.018) * 0.35
  return (f1 + f2) * 0.6
}

// Dust particles
function Dust({ count=2000 }:{count?:number}){
  const ref = useRef<THREE.Points>(null!)
  const positions = useMemo(()=>{
    const arr = new Float32Array(count*3)
    for(let i=0;i<count;i++){
      arr[i*3+0] = (Math.random()-0.5)*180
      arr[i*3+1] = Math.random()*2 + 0.2
      arr[i*3+2] = (Math.random()-0.5)*180
    }
    return arr
  },[count])
  useFrame((state, dt)=>{
    if (!ref.current) return
    const a = ref.current.geometry.attributes.position as THREE.BufferAttribute
    for(let i=0;i<count;i++){
      const y = a.getY(i) + (Math.sin(state.clock.elapsedTime*0.6 + i)*0.001 + 0.02)
      const x = a.getX(i) + 0.01
      a.setY(i, (y>3?0.2:y))
      a.setX(i, (x>90?-90:x))
    }
    a.needsUpdate = true
  })
  const mat = useMemo(()=> new THREE.PointsMaterial({ size: 0.06, color: new THREE.Color('#e6c08c'), transparent:true, opacity:0.65, depthWrite:false }), [])
  return <points ref={ref}>
    <bufferGeometry>
      <bufferAttribute attach="attributes-position" count={positions.length/3} array={positions} itemSize={3} />
    </bufferGeometry>
    <pointsMaterial attach="material" {...(mat as any)} />
  </points>
}

// Stick figure
function StickFigure({ position = new THREE.Vector3() }){
  return (
    <group position={position}>
      <mesh position={[0,1.6,0]}>
        <sphereGeometry args={[0.18, 16, 16]} />
        <meshStandardMaterial color={'#f5dab1'} roughness={0.9} />
      </mesh>
      <mesh position={[0,0.95,0]}>
        <cylinderGeometry args={[0.22,0.25,0.7,12]} />
        <meshStandardMaterial color={'#4c7ac7'} roughness={0.9} />
      </mesh>
      <mesh position={[0,0.45,0]}>
        <cylinderGeometry args={[0.18,0.2,0.8,12]} />
        <meshStandardMaterial color={'#2c2c2c'} roughness={0.95} />
      </mesh>
      <mesh position={[-0.25,1.0,0]} rotation-z={Math.PI/4}>
        <cylinderGeometry args={[0.05,0.05,0.6,8]} />
        <meshStandardMaterial color={'#4c7ac7'} />
      </mesh>
      <mesh position={[0.25,1.0,0]} rotation-z={-Math.PI/4}>
        <cylinderGeometry args={[0.05,0.05,0.6,8]} />
        <meshStandardMaterial color={'#4c7ac7'} />
      </mesh>
      <mesh position={[-0.12,0.1,0]} rotation-z={-Math.PI/8}>
        <cylinderGeometry args={[0.06,0.06,0.7,8]} />
        <meshStandardMaterial color={'#2c2c2c'} />
      </mesh>
      <mesh position={[0.12,0.1,0]} rotation-z={Math.PI/8}>
        <cylinderGeometry args={[0.06,0.06,0.7,8]} />
        <meshStandardMaterial color={'#2c2c2c'} />
      </mesh>
    </group>
  )
}

// Highway distance posts
function MileMarkers(){
  const ref = useRef<THREE.InstancedMesh>(null!)
  const box = useMemo(()=> new THREE.BoxGeometry(0.2, 1.2, 0.2), [])
  const mat = useMemo(()=> new THREE.MeshStandardMaterial({ color:'#c4b38a', roughness:0.9 }), [])
  useEffect(()=>{
    if (!ref.current) return
    const dummy = new THREE.Object3D()
    let i=0
    for(let z=-90; z<=90; z+=10){
      dummy.position.set(-2.5, duneHeight(-2.5, z)+0.6, z)
      dummy.updateMatrix(); ref.current.setMatrixAt(i++, dummy.matrix)
      dummy.position.set(2.5, duneHeight(2.5, z)+0.6, z)
      dummy.updateMatrix(); ref.current.setMatrixAt(i++, dummy.matrix)
    }
    ref.current.count = i
    ref.current.instanceMatrix.needsUpdate = true
  },[])
  return <instancedMesh ref={ref} args={[box, mat, 1000]} />
}

// Minimap canvas
function MiniMap({ ox, oy, digs, player }:{ox:number,oy:number,digs:any[],player:{x:number,y:number}}){
  const ref = useRef<HTMLCanvasElement>(null!)
  useEffect(()=>{
    const c = ref.current; if (!c) return
    const ctx = c.getContext('2d')!
    const w = c.width, h = c.height
    ctx.clearRect(0,0,w,h)
    // background sand
    ctx.fillStyle = '#b8925c'; ctx.fillRect(0,0,w,h)
    // dug cells
    ctx.fillStyle = 'rgba(0,0,0,0.4)'
    digs.forEach((d:any)=>{
      const x = (d.x - ox) / VIEW_W * w
      const y = (d.y - oy) / VIEW_H * h
      ctx.fillRect(x, y, Math.max(2, w/VIEW_W), Math.max(2, h/VIEW_H))
    })
    // player
    ctx.fillStyle = '#00e5ff'
    const px = (player.x - ox) / VIEW_W * w
    const py = (player.y - oy) / VIEW_H * h
    ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI*2); ctx.fill()
    // grid border
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.strokeRect(0,0,w,h)
  },[ox,oy,digs,player])
  return <canvas ref={ref} width={160} height={160} className="rounded-lg border border-white/10" />
}

// Desert surface & environment
function Desert({ ox, oy, digsInView }:{ox:number,oy:number,digsInView:any[]}){
  const sand = useTexture('/textures_desert_plus/sand.jpg')
  const sandNormal = useTexture('/textures_desert_plus/sand_normal.jpg')
  const rock = useTexture('/textures_desert_plus/rock.jpg')
  const bushTex = useTexture('/textures_desert_plus/bush.png')
  const sky = useTexture('/textures_desert_plus/sky_warm.jpg')

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
    const size = 200, segs = 200
    const geom = new THREE.PlaneGeometry(size, size, segs, segs)
    const pos = geom.attributes.position as THREE.BufferAttribute
    for (let i=0;i<pos.count;i++){
      const vx = pos.getX(i)
      const vz = pos.getY(i)
      const h = duneHeight(vx, vz)
      pos.setZ(i, h)
    }
    pos.needsUpdate = true
    geom.computeVertexNormals()
    return geom
  },[])

  const rockGeom = useMemo(()=> new THREE.DodecahedronGeometry(0.5, 0), [])
  const bushGeom = useMemo(()=> new THREE.PlaneGeometry(1,1), [])

  const groundMat = useMemo(()=> new THREE.MeshStandardMaterial({
    map: sand as THREE.Texture, normalMap: sandNormal as THREE.Texture, roughness: 1.0, metalness: 0.0
  }), [sand, sandNormal])
  const rockMat = useMemo(()=> new THREE.MeshStandardMaterial({ map: rock as THREE.Texture, roughness: 0.9 }), [rock])
  const bushMat = useMemo(()=> new THREE.MeshBasicMaterial({ map: bushTex as THREE.Texture, transparent: true, depthWrite: false }), [bushTex])

  const rocks = useRef<THREE.InstancedMesh>(null!)
  const bushes = useRef<THREE.InstancedMesh>(null!)

  useEffect(()=>{
    if (!rocks.current || !bushes.current) return
    const dummy = new THREE.Object3D()
    let ri=0, bi=0
    for (let i=0;i<800;i++){
      const x = (Math.random()-0.5)*180
      const z = (Math.random()-0.5)*180
      const y = duneHeight(x, z)
      dummy.position.set(x, y+0.1, z)
      dummy.rotation.set(0, Math.random()*Math.PI*2, 0)
      const s = 0.4 + Math.random()*0.8
      dummy.scale.set(s,s,s)
      dummy.updateMatrix(); rocks.current.setMatrixAt(ri++, dummy.matrix)
    }
    for (let i=0;i<600;i++){
      const x = (Math.random()-0.5)*180
      const z = (Math.random()-0.5)*180
      const y = duneHeight(x, z)
      dummy.position.set(x, y+0.05, z)
      dummy.rotation.set(0, Math.random()*Math.PI*2, 0)
      const s = 1 + Math.random()*1.5
      dummy.scale.set(s, s, 1)
      dummy.updateMatrix(); bushes.current.setMatrixAt(bi++, dummy.matrix)
    }
    rocks.current.count = ri; rocks.current.instanceMatrix.needsUpdate = true
    bushes.current.count = bi; bushes.current.instanceMatrix.needsUpdate = true
  }, [])

  return (
    <group>
      <mesh geometry={groundGeom} material={groundMat} rotation-x={-Math.PI/2} receiveShadow castShadow />
      <instancedMesh ref={rocks} args={[rockGeom, rockMat, 1000]} castShadow receiveShadow />
      <instancedMesh ref={bushes} args={[bushGeom, bushMat, 800]} castShadow={false} receiveShadow={false} rotation-y={Math.PI/4} />
      <MileMarkers />
      {digsInView.map(d => (
        <Html key={`${d.x},${d.y}`} center transform distanceFactor={25}
          position={[(d.x - ox - VIEW_W/2), duneHeight(d.x - ox - VIEW_W/2, d.y - oy - VIEW_H/2)+0.3, (d.y - oy - VIEW_H/2)]}>
          <div className="text-[10px] md:text-xs tracking-widest font-bold text-amber-200/90"
            style={{ textShadow: '0 0 6px rgba(255,220,120,0.8)' }}>{d.initials}</div>
        </Html>
      ))}
      <Dust count={1500} />
    </group>
  )
}

// Controls + 1st/3rd person
function Controls({ mode, setHovered, setOff, playerPos }:{mode:'fp'|'tp', setHovered:(v:any)=>void, setOff:(fn:(o:{ox:number,oy:number})=>{ox:number,oy:number})=>void, playerPos:THREE.Vector3}){
  const { camera } = useThree()
  const keys = useRef<{[k:string]:boolean}>({})
  const velocity = useRef(new THREE.Vector3())
  const dir = useRef(new THREE.Vector3())
  const raycaster = useMemo(()=>new THREE.Raycaster(),[])
  const plane = useMemo(()=>new THREE.Plane(new THREE.Vector3(0,1,0), 0),[])

  useEffect(()=>{
    if (mode==='fp'){
      camera.position.set(0, 1.7, 6)
    } else {
      camera.position.set(0, 2.0, 6)
    }
    camera.lookAt(0,1.6,0)
  }, [camera, mode])

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
    const sprint = keys.current['shift']
    const speed = sprint ? 16 : 8
    velocity.current.copy(dir.current).applyQuaternion(camera.quaternion).multiplyScalar(speed*delta)

    // move camera
    camera.position.add(new THREE.Vector3(velocity.current.x, 0, velocity.current.z))
    const y = duneHeight(camera.position.x, camera.position.z) + (mode==='fp'?1.7:2.2)
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, y, 0.6)

    // update player position (for third-person and minimap)
    playerPos.set(camera.position.x, 0, camera.position.z)

    // if third-person, offset camera back & up but keep facing forward
    if (mode==='tp'){
      const back = new THREE.Vector3(0,0, -3).applyQuaternion(camera.quaternion)
      const look = new THREE.Vector3().copy(playerPos)
      camera.position.copy(playerPos).add(new THREE.Vector3(0,1.6,0)).add(back)
      camera.lookAt(look.x, duneHeight(look.x, look.z)+1.6, look.z)
    }

    // update offsets for digging window
    setOff(o=>{
      const nx = clamp(Math.floor(o.ox + velocity.current.x), 0, WORLD_W - VIEW_W)
      const ny = clamp(Math.floor(o.oy + velocity.current.z), 0, WORLD_H - VIEW_H)
      return (nx!==o.ox || ny!==o.oy) ? {ox:nx, oy:ny} : o
    })

    // hovered via center ray
    raycaster.setFromCamera(new THREE.Vector2(0,0), camera as any)
    const p = new THREE.Vector3()
    raycaster.ray.intersectPlane(plane, p)
    const gx = Math.round(p.x + VIEW_W/2)
    const gy = Math.round(p.z + VIEW_H/2)
    if (gx>=0 && gx<VIEW_W && gy>=0 && gy<VIEW_H) setHovered({ x: gx, y: gy })
    else setHovered(null)
  })

  return null
}

export default function App(){
  const [user, setUser] = useState<any>(null)
  const [{ox,oy}, setOff] = useState(getOffset())
  const [hovered, setHovered] = useState<{x:number,y:number}|null>(null)
  const [digs, setDigs] = useState<any[]>([])
  const [freeLeft, setFreeLeft] = useState(DAILY_FREE_DIGS)
  const [extraLeft, setExtraLeft] = useState(0)
  const [mode, setMode] = useState<'fp'|'tp'>('fp')
  const [showMap, setShowMap] = useState(false)
  const ended = gameEnded()

  const playerPos = useRef(new THREE.Vector3(0,0,0))

  useEffect(()=>{ setUser(getOrCreateUser()); const a=canDigToday(); setFreeLeft(a.freeLeft); setExtraLeft(a.extraLeft) },[])
  useEffect(()=>{
    let mounted = true
    api.fetchWindow(ox,oy,VIEW_W,VIEW_H).then(res=>mounted && setDigs(res))
    setOffset({ox,oy})
    return ()=>{ mounted=false }
  },[ox,oy])

  const handleDig = async()=>{
    if (!hovered) return
    const res = await api.dig(ox+hovered.x, oy+hovered.y)
    if (!res.ok){ alert(res.reason); return }
    if (res.found) alert('🎉 YOU FOUND THE TREASURE! The game is over.')
    const a = canDigToday(); setFreeLeft(a.freeLeft); setExtraLeft(a.extraLeft)
    const win = await api.fetchWindow(ox,oy,VIEW_W,VIEW_H); setDigs(win)
  }

  // Mobile controls: visible if no pointer lock capability
  const [mobileForward, setMobileForward] = useState(false)
  useEffect(()=>{
    const onPointerLock = ()=>{ /* noop; r3f manages lock via controls */ }
    document.addEventListener('pointerlockchange', onPointerLock)
    return ()=>document.removeEventListener('pointerlockchange', onPointerLock)
  }, [])

  return (
    <div className="min-h-screen w-full" style={{ background: '#0b0f14', color: 'white' }}>
      <header className="flex items-center justify-between p-4 md:p-6 border-b border-amber-500/20 sticky top-0 z-20" style={{ background: '#0b0f14CC', backdropFilter:'blur(6px)' }}>
        <h1 className="text-xl md:text-2xl font-extrabold tracking-tight">CYBER HUNT<span className="text-amber-400">.</span></h1>
        <div className="flex items-center gap-2">
          <button id="enter-desert" className="rounded px-3 py-2 bg-amber-600 hover:bg-amber-500">Click to enter Desert View</button>
          <button className="rounded px-3 py-2 bg-white/10 hover:bg-white/20" onClick={()=>setMode(m=>m==='fp'?'tp':'fp')}>{mode==='fp'?'3rd person':'1st person'}</button>
          <button className="rounded px-3 py-2 bg-white/10 hover:bg-white/20" onClick={()=>setShowMap(s=>!s)}>{showMap?'Hide Map':'Map'}</button>
        </div>
      </header>

      <main className="grid md:grid-cols-[320px_1fr] gap-4 md:gap-6 p-4 md:p-6">
        <div className="bg-[#0e141c] border border-amber-500/20 rounded-2xl p-4 md:p-6">
          <div className="space-y-4">
            <div>
              <div className="text-sm text-white/60">Player</div>
              <div className="text-lg font-semibold">{user?.initials || 'YOU'}</div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="rounded-xl bg-amber-500/10 p-3">
                <div className="text-2xl font-bold text-amber-300">{freeLeft}</div>
                <div className="text-xs text-white/60">Free digs today</div>
              </div>
              <div className="rounded-xl bg-fuchsia-500/10 p-3">
                <div className="text-2xl font-bold text-fuchsia-300">{extraLeft}</div>
                <div className="text-xs text-white/60">Extra digs</div>
              </div>
            </div>
            <div className="text-sm text-white/70">Click the button above to lock the mouse. Use <b>W/A/S/D</b> (Shift = sprint). On phone, use the on‑screen controls. Click <b>DIG</b> to excavate under the crosshair.</div>
            <button onClick={handleDig} className="mt-2 bg-amber-600 hover:bg-amber-500 w-full rounded-lg px-3 py-2 font-semibold">DIG</button>

            <div className="pt-4 border-t border-white/10">
              <div className="text-xs text-white/50 mb-2">Mini Map (current window)</div>
              <MiniMap ox={ox} oy={oy} digs={digs} player={{ x: ox + VIEW_W/2 + playerPos.current.x, y: oy + VIEW_H/2 + playerPos.current.z }} />
            </div>

            <div className="text-xs text-white/40 pt-2">
              {ended ? <div className="text-amber-300">Game ended. Treasure found at ({ended.x}, {ended.y}).</div> : <div>Find the hidden cache. First to hit the exact square wins. 🏴‍☠️</div>}
            </div>
          </div>
        </div>

        <div className="relative rounded-2xl overflow-hidden border border-amber-500/20" style={{ height: '70vh' }}>
          <Canvas shadows camera={{ fov: 70 }}>
            <hemisphereLight skyColor={'#ffe'} groundColor={'#a86'} intensity={0.7} />
            <directionalLight position={[18, 28, -12]} intensity={1.3} color={'#ffcf8a'} castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048} />

            <Controls mode={mode} setHovered={setHovered} setOff={setOff} playerPos={playerPos.current} />
            <Desert ox={ox} oy={oy} digsInView={digs} />

            {mode==='tp' && <StickFigure position={playerPos.current.clone().setY(0)} />}

            
            

            <PointerLockControls selector="#enter-desert" />
            <Html center>
              <div style={{ width: 10, height: 10, borderRadius: 9999, border: '2px solid rgba(255,255,255,0.9)' }}></div>
            </Html>
          </Canvas>

          {/* Mobile controls */}
          <div className="absolute bottom-3 right-3 flex gap-2 md:hidden">
            <button className="px-4 py-3 rounded bg-white/10" onTouchStart={()=>{(window as any).__mobile='left'}} onTouchEnd={()=>{(window as any).__mobile=null}}>⟲</button>
            <button className="px-4 py-3 rounded bg-amber-600">MOVE</button>
            <button className="px-4 py-3 rounded bg-white/10" onTouchStart={()=>{(window as any).__mobile='right'}} onTouchEnd={()=>{(window as any).__mobile=null}}>⟳</button>
          </div>

          {/* Full Map overlay */}
          {showMap && (
            <div className="absolute inset-0 bg-black/70 backdrop-blur p-4">
              <div className="bg-black/40 rounded-xl p-4 h-full flex flex-col">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-white/80 font-semibold">World Map — current window</div>
                  <button className="px-3 py-1 rounded bg-white/10 hover:bg-white/20" onClick={()=>setShowMap(false)}>Close</button>
                </div>
                <div className="flex-1 grid place-items-center">
                  <MiniMap ox={ox} oy={oy} digs={digs} player={{ x: ox + VIEW_W/2 + playerPos.current.x, y: oy + VIEW_H/2 + playerPos.current.z }} />
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
