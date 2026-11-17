import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../lib/random'
import { CONFIG } from './config'
import { CustomerFactory } from './CustomerFactory'
import { GameManager } from './GameManager'
import { SimulationClock } from './SimulationClock'

/** Drive a fresh game until the first customer is standing at the counter. */
function gameWithCustomerAtCounter() {
  const game = new GameManager(42)
  game.update(5) // first arrival is 4 s in
  const spawned = game.drainNotices().find((n) => n.type === 'customerSpawned')
  if (!spawned || spawned.type !== 'customerSpawned') throw new Error('no customer spawned')
  const id = spawned.customerId
  game.customerReachedCounter(id)
  return { game, id }
}

/** Deposit the customer's item in locker-2 and hang its key on hook 5. */
function deposit(game: GameManager, id: string) {
  expect(game.talkTo(id).ok).toBe(true)
  expect(game.choose('greet').ok).toBe(true)
  expect(game.choose('askName').ok).toBe(true)
  expect(game.choose('accept').ok).toBe(true)
  expect(game.hands?.kind).toBe('item')
  expect(game.openLocker('locker-2').ok).toBe(true)
  expect(game.putItem('locker-2').ok).toBe(true)
  expect(game.closeLocker('locker-2').ok).toBe(true)
  expect(game.takeKeyFromLock('locker-2').ok).toBe(true)
  expect(game.hangKey(5).ok).toBe(true)
  expect(game.talkTo(id).ok).toBe(true)
  expect(game.choose('confirmStored').ok).toBe(true)
}

describe('SimulationClock', () => {
  it('fires events in time order, ties in scheduling order', () => {
    const clock = new SimulationClock<string>()
    clock.schedule(5, 'c')
    clock.schedule(1, 'a')
    clock.schedule(5, 'd')
    clock.schedule(3, 'b')
    expect(clock.advance(2)).toEqual(['a'])
    expect(clock.advance(10)).toEqual(['b', 'c', 'd'])
    expect(clock.pending).toBe(0)
  })
})

describe('Milestone 1: first customer', () => {
  it('the tutorial customer is Maya with a blue suitcase', () => {
    const { game, id } = gameWithCustomerAtCounter()
    const c = game.customers.get(id)
    expect(c.name).toBe('Maya Okafor')
    expect(game.customers.itemOf(c)?.label).toBe('blue suitcase')
    expect(c.state).toBe('waiting')
  })

  it('completes a full deposit → short wait → retrieval cycle', () => {
    const { game, id } = gameWithCustomerAtCounter()
    const startMoney = game.economy.money
    deposit(game, id)

    const c = game.customers.get(id)
    expect(c.state).toBe('stored')
    expect(c.lockerId).toBe('locker-2')
    expect(game.lockers.get('locker-2').locked).toBe(true)
    expect(game.keys.onHook(5)?.lockerId).toBe('locker-2')
    // The tutorial wait is fixed, and short (under 30 s).
    const wait = CONFIG.stages[0].returnAfter[0]
    expect(CONFIG.stages[0].returnAfter[1]).toBe(wait)
    expect(wait).toBeLessThan(30)
    expect(c.expectedReturnAt! - c.depositedAt!).toBe(wait)

    // Exactly that long later, not before.
    game.update(wait - 0.1)
    expect(game.customers.get(id).state).toBe('stored')
    game.update(0.2)
    expect(game.customers.get(id).state).toBe('returning')

    game.customerReachedCounter(id)
    expect(game.customers.get(id).state).toBe('waitingForCollection')
    expect(game.talkTo(id).ok).toBe(true)
    expect(game.choose('greet').ok).toBe(true)
    expect(game.takeKeyFromHook(5).ok).toBe(true)
    expect(game.useKeyOn('locker-2').ok).toBe(true)
    expect(game.takeItem('locker-2').ok).toBe(true)
    expect(game.talkTo(id).ok).toBe(true)
    expect(game.choose('handOver').ok).toBe(true)

    expect(game.customers.get(id).state).toBe('completed')
    expect(game.economy.money).toBeGreaterThan(startMoney)
    expect(game.economy.served).toBe(1)
    expect(game.lockers.get('locker-2').state).toBe('available')

    game.customerExited(id)
    expect(game.tutorialComplete).toBe(true)
  })

  it('the wrong key does not open a locker and costs time', () => {
    const { game, id } = gameWithCustomerAtCounter()
    deposit(game, id)
    // Lock a second, empty locker and hang its key, so there are two keys on the board.
    game.closeLocker('locker-4')
    expect(game.takeKeyFromLock('locker-4').ok).toBe(true)
    expect(game.hangKey(1).ok).toBe(true)

    expect(game.takeKeyFromHook(1).ok).toBe(true)
    const wrong = game.useKeyOn('locker-2')
    expect(wrong.ok).toBe(false)
    expect(game.lockers.get('locker-2').locked).toBe(true)
    expect(game.economy.mistakes).toBe(1)
    expect(game.useKeyOn('locker-4').ok).toBe(false) // still fumbling
    game.update(2)
    expect(game.useKeyOn('locker-4').ok).toBe(true)
  })

  it('cannot take a key while the door is open, or store into a shut locker', () => {
    const { game, id } = gameWithCustomerAtCounter()
    game.talkTo(id)
    game.choose('greet')
    game.choose('accept')
    expect(game.putItem('locker-1').ok).toBe(false)
    game.openLocker('locker-1')
    expect(game.takeKeyFromLock('locker-1').ok).toBe(false)
    expect(game.putItem('locker-1').ok).toBe(true)
  })

  it('cannot accept an item before greeting, or tell them it is stored before storing it', () => {
    const { game, id } = gameWithCustomerAtCounter()
    game.talkTo(id)
    expect(game.choose('accept').ok).toBe(false)
    game.choose('greet')
    game.choose('accept')
    expect(game.choose('confirmStored').ok).toBe(false)
  })

  it('a customer never accepts someone else’s item', () => {
    const { game, id } = gameWithCustomerAtCounter()
    deposit(game, id)
    game.update(121)
    game.customerReachedCounter(id)
    // Fake a second customer's item in hand.
    const other = game.customers.get(id)
    const stranger = { ...game.customers.itemOf(other)!, id: 'item-x', customerId: 'cust-x', label: 'red box' }
    game.customers.add({ ...other, id: 'cust-x', itemId: 'item-x', state: 'stored' }, stranger)
    game.hands = { kind: 'item', itemId: 'item-x' }

    game.talkTo(id)
    const result = game.choose('handOver')
    expect(result.ok).toBe(false)
    expect(game.customers.get(id).state).toBe('collecting')
    expect(game.hands).toEqual({ kind: 'item', itemId: 'item-x' })
    expect(game.economy.mistakes).toBe(1)
  })
})

describe('CustomerFactory', () => {
  it('does not repeat first names while unused ones remain', () => {
    const factory = new CustomerFactory(mulberry32(11))
    const firsts = Array.from({ length: 8 }, () => factory.customer({ patience: 100, fee: 15, satisfaction: 70 }).customer.name.split(' ')[0])
    expect(new Set(firsts).size).toBe(8)
  })
})
