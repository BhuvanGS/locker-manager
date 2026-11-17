import type { Customer, CustomerId, CustomerState, Item, ItemId } from './types'

/** Allowed customer state transitions. Anything else is a bug and throws. */
const TRANSITIONS: Record<CustomerState, CustomerState[]> = {
  arriving: ['waiting'],
  waiting: ['depositing', 'leftWithoutService'],
  depositing: ['stored', 'leftWithoutService'],
  stored: ['returning'],
  returning: ['waitingForCollection'],
  waitingForCollection: ['collecting', 'leftWithoutService'],
  collecting: ['completed', 'leftWithoutService'],
  completed: [],
  leftWithoutService: [],
}

/** Owns customer and item records and enforces the customer state machine. */
export class CustomerManager {
  private readonly customers = new Map<CustomerId, Customer>()
  private readonly items = new Map<ItemId, Item>()

  add(customer: Customer, item: Item): void {
    this.customers.set(customer.id, customer)
    this.items.set(item.id, item)
  }

  get(id: CustomerId): Customer {
    const customer = this.customers.get(id)
    if (!customer) throw new Error(`Unknown customer ${id}`)
    return customer
  }

  item(id: ItemId): Item {
    const item = this.items.get(id)
    if (!item) throw new Error(`Unknown item ${id}`)
    return item
  }

  itemOf(customer: Customer): Item | null {
    return customer.itemId ? this.item(customer.itemId) : null
  }

  all(): Customer[] {
    return [...this.customers.values()]
  }

  /** Customers physically in the building or walking in/out. */
  present(): Customer[] {
    return this.all().filter((c) => c.state !== 'stored')
  }

  transition(id: CustomerId, to: CustomerState): Customer {
    const customer = this.get(id)
    if (!TRANSITIONS[customer.state].includes(to)) {
      throw new Error(`Customer ${id}: illegal transition ${customer.state} → ${to}`)
    }
    customer.state = to
    if (to === 'waiting' || to === 'waitingForCollection') {
      customer.patience = customer.maxPatience
      customer.visit = { greeted: false, askedName: false }
    }
    return customer
  }

  /** Remove finished customers from the live set (records could be archived later). */
  forget(id: CustomerId): void {
    const customer = this.customers.get(id)
    if (!customer) return
    if (customer.itemId) this.items.delete(customer.itemId)
    this.customers.delete(id)
  }
}
