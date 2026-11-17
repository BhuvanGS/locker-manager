import * as THREE from 'three'
import type { GameManager } from '../sim/GameManager'
import type { Parcel } from '../sim/ConveyorSystem'
import { fitInto, makeItemMesh } from './models'

/** Size of a bag riding the belts and hanging in a gripper. */
export const BAG = { w: 0.38, h: 0.3, d: 0.3 }

/** A bag for `parcel`'s item, with its base at the group's origin. */
export function makeBag(game: GameManager, parcel: Parcel): THREE.Group {
  const item = game.customers.item(parcel.itemId)
  const mesh = makeItemMesh(item.category, item.color)
  fitInto(mesh, BAG.w, BAG.h, BAG.d)
  const group = new THREE.Group()
  group.add(mesh)
  return group
}
