import * as THREE from 'three'
import { mulberry32 } from '../lib/random'
import type { StoneRecord } from './stone'

export type GravelBounds = {
  centerX: number
  centerZ: number
  width: number
  depth: number
}

export class GravelField {
  readonly root = new THREE.Group()
  readonly bounds: GravelBounds
  readonly stoneCount: number
  readonly stones: StoneRecord[]
  readonly instancedMesh: THREE.InstancedMesh
  readonly fakeStoneId: number

  private readonly dummy = new THREE.Object3D()
  private readonly zeroScale = new THREE.Vector3(0.0001, 0.0001, 0.0001)

  constructor(seed: number, bounds: GravelBounds, stoneCount = 5200) {
    this.bounds = bounds
    this.stoneCount = stoneCount
    const rand = mulberry32(seed)

    const bed = new THREE.Mesh(
      new THREE.BoxGeometry(bounds.width + 0.6, 0.22, bounds.depth + 0.6),
      new THREE.MeshStandardMaterial({
        color: 0x6b5d52,
        roughness: 0.96,
        metalness: 0.02,
      }),
    )
    bed.position.set(bounds.centerX, -0.06, bounds.centerZ)
    bed.receiveShadow = true
    this.root.add(bed)

    const stoneGeo = new THREE.IcosahedronGeometry(1, 0)
    const stoneMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.88,
      metalness: 0.04,
    })

    const mesh = new THREE.InstancedMesh(stoneGeo, stoneMat, stoneCount)
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.instancedMesh = mesh

    const halfW = bounds.width / 2 - 0.35
    const halfD = bounds.depth / 2 - 0.35
    this.stones = []

    for (let i = 0; i < stoneCount; i++) {
      const px = bounds.centerX + (rand() * 2 - 1) * halfW
      const pz = bounds.centerZ + (rand() * 2 - 1) * halfD
      const scale = THREE.MathUtils.lerp(0.035, 0.11, rand() * rand())
      const rotY = rand() * Math.PI * 2
      const sink = scale * 0.35
      const py = scale * 0.45 - sink + 0.02

      const rotation = new THREE.Euler(rand() * 0.4, rotY, rand() * 0.4)
      const grey = THREE.MathUtils.lerp(0.42, 0.72, rand())
      const warm = rand() * 0.06
      const stoneColor = new THREE.Color(grey + warm * 0.3, grey, grey - warm * 0.2)

      this.stones.push({
        id: i,
        position: new THREE.Vector3(px, py, pz),
        rotation,
        scale,
        color: stoneColor,
        picked: false,
        inspected: false,
        disturbed: false,
        isFake: false,
        opened: false,
      })

      this.writeInstanceMatrix(mesh, i, px, py, pz, rotation, scale)
      mesh.setColorAt(i, stoneColor)
    }

    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    this.root.add(mesh)

    this.fakeStoneId = Math.floor(rand() * stoneCount)
    const fake = this.stones[this.fakeStoneId]
    if (fake) {
      fake.isFake = true
      fake.color.set('#ff4fa3')
      mesh.setColorAt(this.fakeStoneId, fake.color)
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }

  setInstanceHidden(index: number, hidden: boolean): void {
    const stone = this.stones[index]
    if (!stone) return
    if (hidden) {
      this.dummy.position.set(0, -500, 0)
      this.dummy.rotation.set(0, 0, 0)
      this.dummy.scale.copy(this.zeroScale)
    } else {
      this.writeInstanceMatrix(
        this.instancedMesh,
        index,
        stone.position.x,
        stone.position.y,
        stone.position.z,
        stone.rotation,
        stone.scale,
      )
    }
    this.dummy.updateMatrix()
    this.instancedMesh.setMatrixAt(index, this.dummy.matrix)
    this.instancedMesh.instanceMatrix.needsUpdate = true
  }

  nudgeInstance(index: number, offset: THREE.Vector3): void {
    const stone = this.stones[index]
    if (!stone || stone.picked) return
    stone.position.add(offset)
    stone.disturbed = true
    this.writeInstanceMatrix(
      this.instancedMesh,
      index,
      stone.position.x,
      stone.position.y,
      stone.position.z,
      stone.rotation,
      stone.scale,
    )
    this.instancedMesh.instanceMatrix.needsUpdate = true
  }

  dispose(): void {
    this.root.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.InstancedMesh) {
        obj.geometry.dispose()
        const mat = obj.material
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
        else mat.dispose()
      }
    })
  }

  private writeInstanceMatrix(
    mesh: THREE.InstancedMesh,
    index: number,
    x: number,
    y: number,
    z: number,
    rotation: THREE.Euler,
    scale: number,
  ): void {
    this.dummy.position.set(x, y, z)
    this.dummy.rotation.copy(rotation)
    this.dummy.scale.setScalar(scale)
    this.dummy.updateMatrix()
    mesh.setMatrixAt(index, this.dummy.matrix)
  }
}