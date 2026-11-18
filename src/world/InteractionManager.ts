import * as THREE from 'three'
import { CONFIG } from '../sim/config'
import type { GameManager } from '../sim/GameManager'
import type { ActionResult } from '../sim/types'
import { findInteractable, type Interactable } from './interactables'
import { REACH } from './layout'
import type { Section } from '../sim/config'

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
const SECTION_NAMES: Record<Section, string> = { shelves: 'racks', cold: 'cold room', vault: 'vault', hidden: 'underground vault' }

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
      case 'conveyorIn':
        return game.loadConveyor()
      case 'conveyorOut':
        return game.takeFromConveyor()
      case 'terminal':
        return game.openTerminal()
      case 'dealDesk':
        return game.openDeal()
      case 'console':
        return game.openConsole(t.scope)
      case 'receivingDesk':
        return game.openReceiving()
      case 'truck':
        return game.hands?.kind === 'crate' ? game.loadCrate(t.truckId) : game.takeCrateFromTruck(t.truckId)
      case 'section':
        return game.hands?.kind === 'crate' ? game.storeCrate(t.section) : game.takeCrateFrom(t.section)
      case 'ladder':
        return { ok: true, message: '' } // the Engine does the climbing
      case 'hatch':
        return game.toggleVaultHatch()
      case 'contact': {
        const c = game.warehouse.contact
        if (c?.job === 'drop' && c.phase === 'asking') return game.agreeContact()
        if (c?.job === 'drop') return game.takeCrateFromContact()
        return game.giveCrateToContact()
      }
      case 'hook':
        return game.hands?.kind === 'key' ? game.hangKey(t.hook) : game.takeKeyFromHook(t.hook)
      case 'lockerKey':
        return game.takeKeyFromLock(t.lockerId)
      case 'lockerInterior':
        return game.hands?.kind === 'item' ? game.putItem(t.lockerId) : game.takeItem(t.lockerId)
      case 'lockerDoor': {
        const locker = game.lockers.get(t.lockerId)
        if (locker.doorOpen) return game.closeLocker(t.lockerId)
        // Digital lockers open for staff without a key.
        if (locker.locked && !game.isDigital) return game.useKeyOn(t.lockerId)
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
      case 'conveyorIn': {
        if (hands?.kind === 'item') return { action: `Put the ${game.customers.item(hands.itemId).label} on the conveyor`, hint: null }
        return none('Loading belt: bring a bag here')
      }
      case 'conveyorOut': {
        const waiting = game.conveyor.returning().length
        if (game.conveyor.readyCount > 0) return hands ? none('Hands full') : { action: 'Take the bag from the return tray', hint: null }
        return none(waiting > 0 ? 'Your bag is on its way…' : 'Return tray: ask the terminal for a bag')
      }
      case 'terminal':
        return { action: 'Use the terminal', hint: null }
      case 'dealDesk': {
        const offer = game.deals.offer
        return offer ? { action: `Talk business with ${offer.name}`, hint: null } : none('Nobody is waiting at the desk')
      }
      case 'console':
        return { action: t.scope === 'hub' ? 'Use the control hub' : t.scope === 'warehouse' ? 'Upgrade the warehouse' : 'Upgrade the robot arms here', hint: null }
      case 'receivingDesk': {
        const n = game.warehouse.loads.length
        return { action: n > 0 ? `Check the ${n} parked load${n === 1 ? '' : 's'}` : 'Receiving desk', hint: null }
      }
      case 'truck': {
        const wh = game.warehouse
        const truck = wh.truck(t.truckId)
        if (!truck) return none()
        const name = truck.owner.split(' (')[0]
        if (truck.phase !== 'parked') return none(truck.phase === 'arriving' ? `${name} is parking…` : `${name} is leaving`)
        if (truck.job === 'collect') {
          if (hands?.kind !== 'crate') return none(hands ? 'Hands full' : `${name} is collecting: bring their crates here`)
          return wh.carrying?.loadId === truck.loadId ? { action: `Load the crate onto ${name}'s truck`, hint: null } : none(`Not ${name}'s crate`)
        }
        if (hands) return none(hands.kind === 'crate' ? 'Store the crate you carry first' : 'Hands full')
        return truck.onBoard > 0 ? { action: `Take a crate off ${name}'s truck (${truck.onBoard} left)`, hint: null } : none('Empty')
      }
      case 'hatch':
        return { action: game.vaultHatchOpen ? 'Slide the hatch shut' : 'Slide the hatch open', hint: null }
      case 'ladder':
        if (t.to === 'down' && !game.vaultHatchOpen) return none('The hatch is shut')
        if (t.to === 'up' && !game.vaultHatchOpen) return { action: 'Push the hatch open and climb up', hint: null }
        if (hands?.kind === 'crate' || hands?.kind === 'item') return { action: t.to === 'down' ? 'Climb down the ladder (with the crate)' : 'Climb up the ladder (with the crate)', hint: null }
        return { action: t.to === 'down' ? 'Climb down the ladder' : 'Climb up the ladder', hint: null }
      case 'contact': {
        const c = game.warehouse.contact
        if (!c || c.phase === 'arriving' || c.phase === 'leaving') return none(c?.phase === 'leaving' ? `${c.name} is leaving` : '')
        const fee = CONFIG.warehouse.cargo.illegal.fee
        if (c.job === 'drop' && c.phase === 'asking') return { action: `Agree to keep ${c.name}'s ${c.crates} crates ($${fee} each when he collects)`, hint: 'Walk away to say no' }
        if (c.job === 'drop') {
          if (hands) return none(hands.kind === 'crate' ? 'Put the crate somewhere first' : 'Hands full')
          return { action: `Take a crate from ${c.name} (${c.crates - c.handed} left)`, hint: null }
        }
        const left = game.warehouse.cratesOf(c.loadId)
        if (game.warehouse.carrying?.loadId === c.loadId) return { action: `Hand ${c.name} his crate`, hint: null }
        return none(`${c.name} wants his crates back: ${left} left`)
      }
      case 'section': {
        const wh = game.warehouse
        const name = SECTION_NAMES[t.section]
        if (hands?.kind === 'crate' && t.section === 'hidden' && wh.carrying?.cargo !== 'illegal') return none('Only the contact\'s crates go down here')
        const contact = wh.contact
        if (!hands && contact?.job === 'pickup' && contact.phase === 'waiting' && wh.consignments.some((o) => o.section === t.section && o.loadId === contact.loadId)) {
          return { action: `Take ${contact.name}'s crate for him`, hint: null }
        }
        if (hands?.kind === 'crate') {
          return wh.sectionFree(t.section) > 0 ? { action: `Store the crate in the ${name}`, hint: null } : none(`The ${name} is full`)
        }
        if (hands) return none('Hands full')
        const c = wh.collectionFrom(t.section)
        if (c) return { action: `Take ${c.owner.split(' (')[0]}'s crate for their truck`, hint: null }
        return none(`${name[0]!.toUpperCase()}${name.slice(1)}: ${wh.sectionStored(t.section)} / ${wh.sectionCapacity(t.section)}`)
      }
      case 'customer': {
        const c = game.customers.get(t.customerId)
        if (game.dialogue?.customerId === c.id) return none()
        if (c.state === 'arriving' || c.state === 'returning') return none('Walking to the counter…')
        if (c.state === 'completed' || c.state === 'leftWithoutService' || c.state === 'stored') return none()
        return { action: 'Talk', hint: null }
      }
      case 'hook': {
        if (game.isDigital) return none('No keys any more')
        const key = game.keys.onHook(t.hook)
        if (hands?.kind === 'key') return key ? none('Hook taken') : { action: 'Hang the key here', hint: null }
        if (!key) return none('Empty hook')
        if (hands) return none('Hands full')
        const keyNumber = game.hasLabels ? ` ${game.lockers.get(key.lockerId).number}` : ''
        return { action: `Take key${keyNumber}`, hint: null }
      }
      case 'lockerKey': {
        if (game.isDigital) return none()
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
        if (locker.state === 'reserved') return none('The robot arm is using it')
        if (locker.locked && game.isDigital) return { action: `Unlock and open ${name}`, hint: null }
        if (locker.locked) return hands?.kind === 'key' ? { action: `Try the key on ${name}`, hint: null } : none('Locked — needs its key')
        return { action: `Open ${name}`, hint: null }
      }
    }
  }
}
