import * as THREE from 'three'

export type StoneRecord = {
  id: number
  position: THREE.Vector3
  rotation: THREE.Euler
  scale: number
  color: THREE.Color
  picked: boolean
  inspected: boolean
  disturbed: boolean
  isFake: boolean
  opened: boolean
}

export function describeStone(record: StoneRecord): {
  title: string
  detail: string
  massLabel: string
} {
  const volume = record.scale ** 3 * 0.42
  const hollow = record.isFake && (record.inspected || record.opened)
  const kg = (volume * (hollow ? 900 : 2600)).toFixed(2)
  const hue = record.color.r > 0.62 ? 'warm grey' : 'river grey'
  let detail = `${hue} pebble. Hold it and drag with right mouse to check the underside.`
  if (record.opened && record.isFake) {
    detail = 'Hollow decorative rock. A house key was clipped inside the seam.'
  } else if (record.inspected && record.isFake) {
    detail = 'Underside opened. The house key is in your hand. Left-click the front door.'
  } else if (record.inspected) {
    detail = `${hue} pebble. Underside: packed grit, no seam. Press F if you want to be sure — it will not open.`
  }
  return {
    title: record.isFake ? 'Pink stone' : `${hue[0].toUpperCase()}${hue.slice(1)} stone`,
    detail,
    massLabel: hollow ? `~${kg} kg · light` : `~${kg} kg`,
  }
}

export function createHeldRockMesh(record: StoneRecord): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1, 0),
    new THREE.MeshStandardMaterial({
      color: record.color,
      roughness: 0.86,
      metalness: 0.05,
    }),
  )
  mesh.scale.setScalar(record.scale)
  mesh.rotation.copy(record.rotation)
  mesh.castShadow = true
  return mesh
}