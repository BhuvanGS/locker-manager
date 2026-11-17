import * as THREE from 'three'
import type { PhysicsWorld } from '../engine/PhysicsWorld'
import { markBlocker } from './interactables'
import { COUNTER, ENTRANCE, FLOOR_Y, KEY_BOARD, PARTITION, ROOM } from './layout'
import { mat } from './models'

/**
 * The static building: street outside, shop front, lobby, counter, staff area, partition and storage
 * room shell. Lockers, keys and people are separate views that read the simulation.
 */
export class Facility {
  readonly root = new THREE.Group()
  private readonly physics: PhysicsWorld
  private doorL: THREE.Mesh | null = null
  private doorR: THREE.Mesh | null = null
  private doorOpen = 0

  constructor(physics: PhysicsWorld) {
    this.physics = physics
    this.buildOutside()
    this.buildShell()
    this.buildLobby()
    this.buildCounter()
    this.buildStaffArea()
    this.buildLights()
  }

  /** Slide the glass entrance doors open while someone is near them. */
  update(dt: number, someoneNearDoor: boolean): void {
    const target = someoneNearDoor ? 1 : 0
    this.doorOpen += (target - this.doorOpen) * Math.min(1, dt * 5)
    const slide = this.doorOpen * 0.98
    if (this.doorL) this.doorL.position.x = -0.5 - slide
    if (this.doorR) this.doorR.position.x = 0.5 + slide
  }

  // ------------------------------------------------------------------ helpers

  /** Solid box: rendered, collides with the player, blocks reach. */
  private solid(w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
    mesh.position.set(x, y, z)
    mesh.receiveShadow = true
    mesh.castShadow = true
    markBlocker(mesh)
    this.root.add(mesh)
    this.physics.addStaticBox(mesh.position.clone(), new THREE.Vector3(w / 2, h / 2, d / 2))
    return mesh
  }

  private deco(w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
    mesh.position.set(x, y, z)
    mesh.receiveShadow = true
    this.root.add(mesh)
    return mesh
  }

  private sign(text: string, w: number, h: number, bg: string, fg: string): THREE.Mesh {
    const canvas = document.createElement('canvas')
    canvas.width = 1024
    canvas.height = Math.round((1024 * h) / w)
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = fg
      ctx.font = `700 ${Math.round(canvas.height * 0.5)}px system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(text, canvas.width / 2, canvas.height / 2)
    }
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4
    return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }))
  }

  // ------------------------------------------------------------------ parts

  private buildOutside(): void {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), mat(0x5d7a4e, 1))
    ground.rotation.x = -Math.PI / 2
    ground.position.y = FLOOR_Y - 0.02
    ground.receiveShadow = true
    this.root.add(ground)
    this.physics.addStaticBox(new THREE.Vector3(0, -0.5, 0), new THREE.Vector3(60, 0.48, 60))

    this.deco(60, 0.04, 4, mat(0xbdb8b0, 0.95), 0, 0.0, 8.2)
    this.deco(60, 0.03, 8, mat(0x3a3d43, 0.9), 0, -0.005, 14.2)
    for (let x = -28; x < 30; x += 4) this.deco(2, 0.01, 0.15, mat(0xf2d16b, 0.6), x, 0.012, 14.2)

    // Buildings across the street.
    const fronts = [0xc9b8a3, 0xa7b8c9, 0xd6c2b4, 0xb7c4ae, 0xcfc6b8]
    for (let i = 0; i < 6; i++) {
      const h = 5 + (i % 3) * 2.2
      const x = -25 + i * 10
      this.deco(9, h, 6, mat(fronts[i % fronts.length] ?? 0xcccccc, 0.9), x, h / 2, 22)
      for (let fx = -3; fx <= 3; fx += 2) {
        for (let fy = 1.6; fy < h - 0.8; fy += 1.8) this.deco(1.1, 1, 0.05, mat(0x9fbfd6, 0.2, 0.3), x + fx, fy, 18.97)
      }
    }
    // Neighbouring shops on our side.
    this.deco(10, 4.4, 15, mat(0xb9a58f, 0.9), -11.2, 2.2, -1.5)
    this.deco(10, 3.8, 15, mat(0xa9b6bf, 0.9), 11.2, 1.9, -1.5)
  }

  private buildShell(): void {
    const wall = mat(0xe9e4da, 0.9)
    const { minX, maxX, minZ, maxZ, height } = ROOM
    const t = 0.2
    const width = maxX - minX
    const depth = maxZ - minZ
    const cz = (minZ + maxZ) / 2

    // Floors: warm tiles in the lobby, grey vinyl behind the counter and in storage.
    this.deco(width, 0.02, maxZ - COUNTER.z, mat(0xcdbfa8, 0.8), 0, 0.005, (maxZ + COUNTER.z) / 2)
    this.deco(width, 0.02, COUNTER.z - minZ, mat(0x8f949a, 0.85), 0, 0.005, (COUNTER.z + minZ) / 2)
    const ceiling = this.deco(width, 0.1, depth, mat(0xf4f2ee, 1), 0, height + 0.05, cz)
    ceiling.receiveShadow = false

    // Side and back walls.
    this.solid(t, height, depth, wall, minX - t / 2, height / 2, cz)
    this.solid(t, height, depth, wall, maxX + t / 2, height / 2, cz)
    this.solid(width + t * 2, height, t, wall, 0, height / 2, minZ - t / 2)

    // Front wall with a glass entrance and two shop windows.
    const front = mat(0x2f3e4f, 0.6, 0.2)
    const sideW = maxX - ENTRANCE.halfWidth
    const sideX = ENTRANCE.halfWidth + sideW / 2
    for (const s of [-1, 1]) {
      this.solid(sideW, 0.9, t, front, s * sideX, 0.45, maxZ + t / 2)
      this.solid(sideW, height - 2.5, t, front, s * sideX, 2.5 + (height - 2.5) / 2, maxZ + t / 2)
      this.solid(0.2, 1.6, t, front, s * (ENTRANCE.halfWidth + 0.1), 1.7, maxZ + t / 2)
      this.solid(0.2, 1.6, t, front, s * (maxX - 0.1), 1.7, maxZ + t / 2)
      const glass = new THREE.Mesh(
        new THREE.BoxGeometry(sideW - 0.4, 1.6, 0.04),
        new THREE.MeshStandardMaterial({ color: 0xbcd7e6, transparent: true, opacity: 0.28, roughness: 0.05, metalness: 0.4 }),
      )
      glass.position.set(s * sideX, 1.7, maxZ + t / 2)
      markBlocker(glass)
      this.root.add(glass)
      this.physics.addStaticBox(glass.position.clone(), new THREE.Vector3((sideW - 0.4) / 2, 0.8, 0.05))
    }
    this.solid(ENTRANCE.halfWidth * 2, height - ENTRANCE.height, t, front, 0, ENTRANCE.height + (height - ENTRANCE.height) / 2, maxZ + t / 2)

    // Sliding glass doors (visual only; customers and the player pass when open).
    const doorMat = new THREE.MeshStandardMaterial({ color: 0xcfe6f2, transparent: true, opacity: 0.32, roughness: 0.05, metalness: 0.5 })
    const frameMat = mat(0x6b7280, 0.4, 0.6)
    const makeDoor = (x: number) => {
      const door = new THREE.Mesh(new THREE.BoxGeometry(1, ENTRANCE.height - 0.05, 0.04), doorMat)
      door.position.set(x, (ENTRANCE.height - 0.05) / 2, maxZ + 0.3)
      door.add(new THREE.Mesh(new THREE.BoxGeometry(1, 0.06, 0.06), frameMat).translateY(-(ENTRANCE.height - 0.05) / 2 + 0.03))
      door.add(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.5, 0.06), frameMat).translateX(x < 0 ? 0.45 : -0.45))
      this.root.add(door)
      return door
    }
    this.doorL = makeDoor(-0.5)
    this.doorR = makeDoor(0.5)

    const sign = this.sign('LOCKER MANAGER', 4.4, 0.6, '#0f172a', '#fbbf24')
    sign.position.set(0, 2.85, maxZ + 0.32)
    this.root.add(sign)
    const hours = this.sign('Bag & luggage storage · Open', 2.2, 0.28, '#f8fafc', '#0f172a')
    hours.position.set(-3.5, 2.1, maxZ + 0.32)
    this.root.add(hours)
  }

  private buildLobby(): void {
    // Bench along the left wall.
    const wood = mat(0x8a5a3b, 0.7)
    const steel = mat(0x4b5563, 0.4, 0.6)
    this.solid(0.5, 0.08, 2.4, wood, ROOM.minX + 0.4, 0.46, 3.8)
    for (const z of [2.8, 4.8]) this.deco(0.06, 0.42, 0.06, steel, ROOM.minX + 0.4, 0.21, z)
    // Plants in the corners.
    for (const [x, z] of [
      [ROOM.maxX - 0.5, 5.4],
      [ROOM.minX + 0.5, 5.4],
    ] as const) {
      this.deco(0.4, 0.45, 0.4, mat(0x9a6b4f, 0.8), x, 0.225, z)
      const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 1), mat(0x2f6b3a, 0.85))
      leaves.position.set(x, 0.85, z)
      leaves.scale.y = 1.3
      this.root.add(leaves)
    }
    // Rug and queue posts.
    this.deco(2.4, 0.01, 2.6, mat(0x7c2d12, 0.95), 0, 0.02, 3.3)
    const price = this.sign('Storage $15 · pay on collection', 2.4, 0.4, '#1e293b', '#e2e8f0')
    price.position.set(3.3, 2.2, ROOM.maxZ - 0.11)
    price.rotation.y = Math.PI
    this.root.add(price)
  }

  private buildCounter(): void {
    const { minX, maxX, z, depth, height } = COUNTER
    const w = maxX - minX
    const cx = (minX + maxX) / 2
    this.solid(w, height - 0.06, depth, mat(0x334155, 0.6), cx, (height - 0.06) / 2, z)
    const top = this.deco(w + 0.1, 0.06, depth + 0.14, mat(0xd6c7ae, 0.4), cx, height - 0.03, z)
    markBlocker(top)
    // Bell and a "staff only" sign on the counter.
    const bell = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xd4af37, 0.3, 0.9))
    bell.position.set(1.6, height, z + 0.1)
    this.root.add(bell)
    // Monitor-less till for now (the computer terminal is a Stage 3 upgrade).
    this.deco(0.36, 0.14, 0.26, mat(0x1f2937, 0.5), -1.8, height + 0.07, z - 0.05)
  }

  private buildStaffArea(): void {
    const wall = mat(0xdcd6cb, 0.9)
    const { z, doorHalfWidth } = PARTITION
    const t = 0.2
    const sideW = ROOM.maxX - doorHalfWidth
    for (const s of [-1, 1]) {
      this.solid(sideW, ROOM.height, t, wall, s * (doorHalfWidth + sideW / 2), ROOM.height / 2, z)
    }
    this.solid(doorHalfWidth * 2, ROOM.height - 2.3, t, wall, 0, 2.3 + (ROOM.height - 2.3) / 2, z)

    const storage = this.sign('STORAGE', 1.2, 0.26, '#0f172a', '#e2e8f0')
    storage.position.set(0, 2.5, z + 0.11)
    this.root.add(storage)
    const keys = this.sign('KEYS', 0.6, 0.18, '#0f172a', '#fbbf24')
    keys.position.set(KEY_BOARD.center.x, KEY_BOARD.center.y + KEY_BOARD.height / 2 + 0.16, KEY_BOARD.center.z)
    this.root.add(keys)

    // Shelving in the storage room for atmosphere (future expansion space).
    const shelf = mat(0x9ca3af, 0.5, 0.5)
    for (const x of [ROOM.minX + 0.35, ROOM.maxX - 0.35]) {
      this.solid(0.5, 0.04, 2.6, shelf, x, 0.6, -6)
      this.solid(0.5, 0.04, 2.6, shelf, x, 1.3, -6)
      for (const dz of [-1.25, 1.25]) this.deco(0.04, 1.4, 0.04, shelf, x, 0.7, -6 + dz)
      this.deco(0.35, 0.28, 0.3, mat(0xb08a5a, 0.85), x, 0.76, -6.6)
      this.deco(0.3, 0.22, 0.3, mat(0xb08a5a, 0.85), x, 1.43, -5.4)
    }
  }

  private buildLights(): void {
    const hemi = new THREE.HemisphereLight(0xf5f0e6, 0x6b6257, 1.1)
    this.root.add(hemi)
    const sun = new THREE.DirectionalLight(0xfff1d6, 1.6)
    sun.position.set(-8, 14, 16)
    sun.castShadow = true
    sun.shadow.mapSize.set(1024, 1024)
    sun.shadow.camera.left = -14
    sun.shadow.camera.right = 14
    sun.shadow.camera.top = 14
    sun.shadow.camera.bottom = -14
    sun.shadow.bias = -0.0005
    this.root.add(sun)

    const panel = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff8e7, emissiveIntensity: 1.2 })
    for (const [x, z] of [
      [-2.5, 3.8],
      [2.5, 3.8],
      [0, -0.6],
      [0, -5],
      [0, -7.6],
    ] as const) {
      const light = new THREE.PointLight(0xfff4e0, 9, 9, 1.6)
      light.position.set(x, ROOM.height - 0.25, z)
      this.root.add(light)
      const fixture = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 0.4), panel)
      fixture.position.set(x, ROOM.height - 0.03, z)
      this.root.add(fixture)
    }
  }
}
