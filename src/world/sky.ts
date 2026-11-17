import * as THREE from 'three'
import { mulberry32 } from '../lib/random'

/** Direction the sunlight comes from; also where the visible sun sits in the sky. */
const SUN_DIR = new THREE.Vector3(-0.78, 0.5, 0.36).normalize()

export type Sky = {
  /** Sky dome, sun, clouds and the sun/hemisphere lights. Add to the scene once. */
  group: THREE.Group
  /** Drift the clouds. Call every frame. */
  update: (dt: number) => void
}

/** Builds the afternoon sky: gradient dome, visible sun, drifting clouds and matching lights. */
export function createSky(): Sky {
  const root = new THREE.Group()
  const clouds: { group: THREE.Group; speed: number }[] = []

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(480, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x3d8fd9) },
        horizon: { value: new THREE.Color(0xcfe6f5) },
        ground: { value: new THREE.Color(0xa9c6a0) },
        sunDir: { value: SUN_DIR.clone() },
        sunColor: { value: new THREE.Color(0xffe3a8) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 top;
        uniform vec3 horizon;
        uniform vec3 ground;
        uniform vec3 sunDir;
        uniform vec3 sunColor;
        varying vec3 vDir;
        void main() {
          float h = vDir.y;
          vec3 col = h > 0.0
            ? mix(horizon, top, pow(clamp(h, 0.0, 1.0), 0.55))
            : mix(horizon, ground, clamp(-h * 6.0, 0.0, 1.0));
          float sunAmt = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
          col += sunColor * pow(sunAmt, 12.0) * 0.35;
          col += sunColor * pow(sunAmt, 220.0) * 0.6;
          gl_FragColor = vec4(col, 1.0);
        }`,
    }),
  )
  sky.renderOrder = -10
  sky.frustumCulled = false
  sky.onBeforeRender = (_r, _s, camera) => sky.position.copy(camera.position)
  root.add(sky)

  // Visible sun: a soft halo plus a bright core, both ignoring fog.
  const sunPos = SUN_DIR.clone().multiplyScalar(420)
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: radialTexture([
        [0, 'rgba(255,244,214,0.85)'],
        [0.25, 'rgba(255,226,160,0.35)'],
        [1, 'rgba(255,220,150,0)'],
      ]),
      fog: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.AdditiveBlending,
    }),
  )
  halo.scale.setScalar(170)
  const core = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: radialTexture([
        [0, 'rgba(255,255,250,1)'],
        [0.55, 'rgba(255,246,214,1)'],
        [0.75, 'rgba(255,236,180,0.4)'],
        [1, 'rgba(255,230,170,0)'],
      ]),
      fog: false,
      depthWrite: false,
      transparent: true,
    }),
  )
  core.scale.setScalar(34)
  const sunGroup = new THREE.Group()
  sunGroup.add(halo, core)
  halo.renderOrder = -9
  core.renderOrder = -8
  // So far away that walking around the yard gives no visible parallax.
  sunGroup.position.copy(sunPos)
  root.add(sunGroup)

  // Puffy clouds drifting slowly across the sky.
  const cloudMat = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    emissive: 0xc9d9e8,
    emissiveIntensity: 0.45,
    fog: false,
    flatShading: true,
  })
  const rand = mulberry32(7)
  const puff = new THREE.IcosahedronGeometry(1, 1)
  for (let i = 0; i < 16; i++) {
    const group = new THREE.Group()
    const puffs = 4 + Math.floor(rand() * 4)
    for (let p = 0; p < puffs; p++) {
      const mesh = new THREE.Mesh(puff, cloudMat)
      const r = 5 + rand() * 6
      mesh.scale.set(r * 1.4, r * 0.7, r)
      mesh.position.set((p - puffs / 2) * 7 + rand() * 4, rand() * 3, rand() * 6 - 3)
      group.add(mesh)
    }
    const angle = rand() * Math.PI * 2
    const dist = 120 + rand() * 160
    group.position.set(Math.cos(angle) * dist, 70 + rand() * 45, Math.sin(angle) * dist)
    root.add(group)
    clouds.push({ group, speed: 1.2 + rand() * 1.6 })
  }

  // Lights (direction matches the visible sun).
  const hemi = new THREE.HemisphereLight(0xc4ddff, 0x5a6e45, 0.7)
  root.add(hemi)
  const sun = new THREE.DirectionalLight(0xfff0d6, 1.35)
  sun.position.copy(SUN_DIR).multiplyScalar(45)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.left = -34
  sun.shadow.camera.right = 34
  sun.shadow.camera.top = 34
  sun.shadow.camera.bottom = -34
  sun.shadow.camera.far = 120
  sun.shadow.bias = -0.0004
  root.add(sun)
  root.add(sun.target)
  sun.target.position.set(0, 0, 6)

  return {
    group: root,
    update(dt: number) {
      for (const cloud of clouds) {
        cloud.group.position.x += cloud.speed * dt
        if (cloud.group.position.x > 260) cloud.group.position.x = -260
      }
    },
  }
}

function radialTexture(stops: [number, string][]): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 256
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128)
    for (const [at, color] of stops) g.addColorStop(at, color)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 256, 256)
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}
