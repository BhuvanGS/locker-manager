import type * as THREE from 'three'
import type { CustomerId, LockerId } from '../sim/types'

/** What a 3D object is, for the interaction raycast. Stored on `object.userData.interact`. */
export type Interactable =
  | { kind: 'customer'; customerId: CustomerId }
  | { kind: 'lockerDoor'; lockerId: LockerId }
  | { kind: 'lockerInterior'; lockerId: LockerId }
  | { kind: 'lockerKey'; lockerId: LockerId }
  | { kind: 'hook'; hook: number }
  | { kind: 'catalogue' }
  /** The loading end of the IN belt, the collection tray at the end of the OUT belt, and the conveyor terminal. */
  | { kind: 'conveyorIn' }
  | { kind: 'conveyorOut' }
  | { kind: 'terminal' }
  /** An automation upgrade console: `hub` or the zone whose arms it controls. */
  | { kind: 'console'; scope: 'hub' | 'main' | 'east' | 'south' | 'floor1' | 'floor2' }

export function tag(object: THREE.Object3D, data: Interactable): void {
  object.userData.interact = data
}

/** Marks solid scenery that blocks reaching through it (walls, counter). */
export function markBlocker(object: THREE.Object3D): void {
  object.userData.blocker = true
}

/** Walk up from a raycast hit to the nearest tagged ancestor. */
export function findInteractable(object: THREE.Object3D | null): Interactable | 'blocker' | null {
  let o: THREE.Object3D | null = object
  while (o) {
    const data = o.userData.interact as Interactable | undefined
    if (data) return data
    if (o.userData.blocker) return 'blocker'
    o = o.parent
  }
  return null
}
