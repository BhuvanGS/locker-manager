import * as THREE from 'three'
import type { GameManager } from '../sim/GameManager'
import type { ActionResult } from '../sim/types'
import { findInteractable, type Interactable } from './interactables'
import { REACH } from './layout'

export type Aim = {
  target: Interactable
  /** What pressing E / clicking will do, or null if nothing useful. */
  action: string | null
  /** Why nothing happens, shown dimmed. */
  hint: string | null
}

/**
 * Finds what is under the crosshair and turns it into a context action against the simulation.
 * One button (E or left click) does the obvious thing for whatever you are looking at.
 */
export class InteractionManager {
  private readonly raycaster = new THREE.Raycaster()
  private readonly center = new THREE.Vector2(0, 0)
  private readonly targets: THREE.Object3D[]

  /** `targets` is kept by reference: push new roots onto it (e.g. a bought locker bank) and they become usable. */
  constructor(targets: THREE.Object3D[]) {
    this.targets = targets
  }

  aim(camera: THREE.Camera, game: GameManager): Aim | null {
    this.raycaster.setFromCamera(this.center, camera)
    this.raycaster.far = REACH.customer
    const hits = this.raycaster.intersectObjects(this.targets, true)
    for (const hit of hits) {
      const found = findInteractable(hit.object)
      if (found === null) continue
      if (found === 'blocker') return null
      const reach = found.kind === 'customer' ? REACH.customer : REACH.default
      if (hit.distance > reach) return null
      return { target: found, ...this.describe(found, game) }
    }
    return null
  }

  perform(aim: Aim, game: GameManager): ActionResult | null {
    if (!aim.action) return aim.hint ? { ok: false, message: aim.hint } : null
    const t = aim.target
    switch (t.kind) {
      case 'customer':
        return game.talkTo(t.customerId)
      case 'catalogue':
        return game.openCatalogue()
      case 'hook':
        return game.hands?.kind === 'key' ? game.hangKey(t.hook) : game.takeKeyFromHook(t.hook)
      case 'lockerKey':
        return game.takeKeyFromLock(t.lockerId)
      case 'lockerInterior':
        return game.hands?.kind === 'item' ? game.putItem(t.lockerId) : game.takeItem(t.lockerId)
      case 'lockerDoor': {
        const locker = game.lockers.get(t.lockerId)
        if (locker.doorOpen) return game.closeLocker(t.lockerId)
        if (locker.locked) return game.useKeyOn(t.lockerId)
        return game.openLocker(t.lockerId)
      }
    }
  }

  private describe(t: Interactable, game: GameManager): { action: string | null; hint: string | null } {
    const hands = game.hands
    const none = (hint: string | null = null) => ({ action: null, hint })
    switch (t.kind) {
      case 'catalogue':
        return { action: 'Browse the supplier catalogue', hint: null }
      case 'customer': {
        const c = game.customers.get(t.customerId)
        if (game.dialogue?.customerId === c.id) return none()
        if (c.state === 'arriving' || c.state === 'returning') return none('Walking to the counter…')
        if (c.state === 'completed' || c.state === 'leftWithoutService' || c.state === 'stored') return none()
        return { action: 'Talk', hint: null }
      }
      case 'hook': {
        const key = game.keys.onHook(t.hook)
        if (hands?.kind === 'key') return key ? none('Hook taken') : { action: 'Hang the key here', hint: null }
        if (!key) return none('Empty hook')
        if (hands) return none('Hands full')
        const keyNumber = game.hasLabels ? ` ${game.lockers.get(key.lockerId).number}` : ''
        return { action: `Take key${keyNumber}`, hint: null }
      }
      case 'lockerKey': {
        const locker = game.lockers.get(t.lockerId)
        if (locker.doorOpen) return none('Close the door to lock it')
        if (hands) return none('Hands full')
        const keyNumber = game.hasLabels ? ` ${locker.number}` : ''
        return { action: `Take key${keyNumber} (locks it)`, hint: null }
      }
      case 'lockerInterior': {
        const locker = game.lockers.get(t.lockerId)
        if (!locker.doorOpen) return none()
        if (hands?.kind === 'item') {
          if (locker.itemId) return none('Already in use')
          return { action: `Store the ${game.customers.item(hands.itemId).label}`, hint: null }
        }
        if (locker.itemId) {
          if (hands) return none('Hands full')
          return { action: `Take the ${game.customers.item(locker.itemId).label}`, hint: null }
        }
        return none('Empty')
      }
      case 'lockerDoor': {
        const locker = game.lockers.get(t.lockerId)
        const name = game.hasLabels ? `locker ${locker.number}` : 'door'
        if (locker.doorOpen) return { action: `Close ${name}`, hint: null }
        if (locker.locked) return hands?.kind === 'key' ? { action: `Try the key on ${name}`, hint: null } : none('Locked — needs its key')
        return { action: `Open ${name}`, hint: null }
      }
    }
  }
}
