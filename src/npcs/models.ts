import * as THREE from 'three'

export function makePerson(color: number): THREE.Group {
  const group = new THREE.Group()
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.28, 0.7, 4, 8),
    new THREE.MeshStandardMaterial({ color, roughness: 0.7 }),
  )
  body.position.y = 0.95
  body.castShadow = true
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0xf3d5b5, roughness: 0.65 }),
  )
  head.position.y = 1.55
  head.castShadow = true
  group.add(body, head)
  return group
}

export function makeOfficer(): THREE.Group {
  const group = new THREE.Group()
  const navy = new THREE.MeshStandardMaterial({ color: 0x1e3a8a, roughness: 0.65 })
  const dark = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.7 })
  const skin = new THREE.MeshStandardMaterial({ color: 0xf3d5b5, roughness: 0.65 })
  const gold = new THREE.MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.45, metalness: 0.2 })
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.7, 0.28), dark)
  legs.position.y = 0.35
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), navy)
  torso.position.y = 1.02
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.5, 0.14), navy)
  armL.position.set(-0.34, 1.02, 0)
  const armR = armL.clone()
  armR.position.x = 0.34
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), skin)
  head.position.y = 1.52
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.34), dark)
  cap.position.y = 1.7
  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.04, 0.22), dark)
  brim.position.set(0, 1.64, 0.12)
  const badge = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.02), gold)
  badge.position.set(0.12, 1.12, 0.16)
  group.add(legs, torso, armL, armR, head, cap, brim, badge)
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) obj.castShadow = true
  })
  return group
}

export function makeCruiser(): THREE.Group {
  const group = new THREE.Group()
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.8, 0.7, 4.2),
    new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.45 }),
  )
  body.position.y = 0.7
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.55, 2),
    new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4 }),
  )
  cabin.position.set(0, 1.25, -0.2)
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(1.82, 0.16, 4.22),
    new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.5 }),
  )
  stripe.position.y = 0.85
  const bar = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.12, 0.28),
    new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.4 }),
  )
  bar.position.set(0, 1.58, -0.2)
  const red = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.1, 0.2),
    new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0x7f1d1d, emissiveIntensity: 0.6 }),
  )
  red.position.set(-0.16, 1.68, -0.2)
  const blue = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.1, 0.2),
    new THREE.MeshStandardMaterial({ color: 0x3b82f6, emissive: 0x1e3a8a, emissiveIntensity: 0.6 }),
  )
  blue.position.set(0.16, 1.68, -0.2)
  group.add(body, cabin, stripe, bar, red, blue)
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) obj.castShadow = true
  })
  return group
}
