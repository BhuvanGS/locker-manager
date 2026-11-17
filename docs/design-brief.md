# MASTER DEVELOPMENT PROMPT
# LOCKER MANAGER — From Memory to Automation

> The original design brief for the game, kept verbatim. Progress against it is tracked in
> [ROADMAP.md](ROADMAP.md).

## 1. PROJECT VISION

Build a browser-based 3D management and simulation game centred around operating a personal locker storage facility.

The player starts as a single employee managing a tiny storage facility. Customers arrive, deposit their belongings, receive a storage key and return later to retrieve their items.

Initially, the player must manually remember:
- Customer names.
- Items deposited.
- Assigned locker locations.
- Which key belongs to which locker.
- When customers are expected to return.

As customer traffic increases, the player becomes overwhelmed by manual management.

The player must progressively expand the facility, improve organisation, unlock management tools, introduce digital systems and eventually automate the entire operation.

### Core fantasy

Start with a notebook and a wall of keys.

End with a fully automated storage facility managing thousands of customers and storage units.

The central progression philosophy:

**Manual labour → Organisation → Digitalisation → Mechanisation → Automation.**

The game should feel satisfying, progressively complex, immersive and rewarding.

---

## 2. CORE GAMEPLAY LOOP

The primary gameplay loop is:

1. Customer arrives.
2. Customer requests storage for an item.
3. Player identifies the customer and accepts the item.
4. Player assigns an available locker.
5. Player physically stores the item.
6. Player records or remembers the customer's name and locker location.
7. Customer leaves with a collection key or reference.
8. Customer returns after a predetermined interval.
9. Player identifies the customer.
10. Player retrieves the correct item.
11. Player returns the item and receives payment.
12. Revenue and experience contribute towards expansion and upgrades.

The first customer should be a tutorial experience.

The player should experience a complete deposit-and-retrieval cycle before additional customers are introduced.

---

## 3. CUSTOMER PROGRESSION AND DIFFICULTY

Customer traffic must increase progressively.

### Initial stage

- Start with one customer.
- The first customer returns exactly two minutes after depositing their item.
- Give the player sufficient time to understand the mechanics.
- Do not introduce unnecessary complexity during the first interaction.

### Second stage

- Introduce a second customer.
- Arrival times become random.
- Both customers can have active deposits simultaneously.
- Their retrieval requests may overlap.

### Third stage

- Introduce a third customer.
- Increase the number of active deposits.
- Introduce more diverse items and customer names.
- Begin testing the player's ability to remember multiple storage locations.

### Fourth stage

- Introduce a fourth customer.
- Increase arrival frequency.
- Create simultaneous deposit and collection requests.
- Introduce waiting queues and customer patience.

### Later stages

Gradually increase customer volume based on:
- Facility capacity.
- Player progression.
- Upgrade level.
- Customer satisfaction.
- Business reputation.

The long-term target is the ability to manage thousands of active customer records.

IMPORTANT: Do not simply increase customer movement speed or make timers unfairly short. Increase complexity through overlapping requests, storage management and operational decisions.

---

## 4. CUSTOMER SYSTEM

Customers must be independent entities with persistent data.

Each customer should have:

- Unique customer ID.
- Full name.
- Appearance.
- Deposited item.
- Assigned locker.
- Deposit timestamp.
- Expected return timestamp.
- Payment information.
- Patience level.
- Customer satisfaction.
- Current interaction state.

### Customer states

Implement a state machine:

- Arriving.
- Waiting.
- Depositing.
- Stored.
- Returning.
- Waiting for collection.
- Collecting.
- Completed.
- Left without service.

Customers should have varied appearances, names, personalities and dialogue.

Do not generate customers with identical behaviour.

### Customer arrival system

Create a central customer spawning and scheduling system.

Each arrival should be generated using configurable timing parameters.

Avoid hardcoding individual customer timers.

Use a central simulation clock and scheduled events.

Each customer must have an independent return timestamp.

Example:

Customer A deposits at 00:00 and returns at 02:00.

Customer B deposits at 00:45 and returns at 03:15.

Customer C deposits at 01:20 and returns at 04:00.

The exact timings should be configurable.

Customers should not all return in a predictable queue.

---

## 5. ITEM AND INVENTORY SYSTEM

Customers can deposit different belongings.

Initial item categories:

- Handbags.
- Suitcases.
- Backpacks.
- Laptop bags.
- Shopping bags.
- Musical instruments.
- Boxes.
- Personal accessories.

Every deposited item must have a unique item ID.

Item metadata should include:

- Item ID.
- Item category.
- Visual model reference.
- Customer ID.
- Assigned locker ID.
- Deposit timestamp.
- Collection status.

The logical inventory system must remain separate from the physical 3D objects.

A customer must never receive another customer's belongings.

Incorrect retrieval must be treated as a significant operational mistake.

---

## 6. LOCKER AND STORAGE SYSTEM

The facility begins with a very limited number of storage compartments.

Each locker should have:

- Unique locker ID.
- Physical location.
- Capacity.
- Availability status.
- Occupied item reference.
- Maintenance status.

Possible locker states:

- Available.
- Occupied.
- Reserved.
- Unavailable.
- Under maintenance.

The storage allocation system should automatically identify available lockers when automation upgrades are unlocked.

Initially, allocation can be manual.

The player should physically interact with lockers and storage compartments.

### Storage expansion

Unlock additional storage through progression.

Expansion can include:

- More locker rows.
- Additional storage walls.
- Larger storage rooms.
- Multiple floors.
- Specialised storage compartments.
- High-capacity warehouse sections.

---

## 7. KEY MANAGEMENT SYSTEM

Keys are central to the early gameplay.

Initially, the facility has an unlabelled wall of keys.

The player must remember which key belongs to which customer and locker.

### Initial mechanics

- Keys look visually similar.
- The player manually identifies and selects keys.
- Incorrect key selection causes retrieval delays.
- Incorrect locker selection can produce retrieval errors.

### Key upgrades

Progressively unlock:

1. Numbered key labels.
2. Colour-coded key groups.
3. Organised key cabinets.
4. Digital key records.
5. Barcode identification.
6. Automated key tracking.

A key should always reference a specific locker and deposit record.

---

## 8. CUSTOMER MEMORY AND RECORD KEEPING

The initial experience must emphasise manual memory.

The player starts without a sophisticated digital interface.

They must remember customer names, belongings and locker positions.

As the facility expands, unlock:

### Stage 1 — Manual memory

No customer database.

### Stage 2 — Notebook

A physical register where customer names and locker assignments can be recorded.

### Stage 3 — Labels

Keys and lockers receive visible identifiers.

### Stage 4 — Customer register

A searchable customer database.

### Stage 5 — Digital inventory

Customer records, items and locker assignments are automatically synchronised.

### Stage 6 — Automated management

The system handles customer identification, locker allocation and retrieval instructions.

Progression should gradually remove manual cognitive burden.

---

## 9. CUSTOMER PATIENCE AND SATISFACTION

Customers should not wait indefinitely.

Implement a patience system.

Patience decreases while customers wait for service.

Customer satisfaction is influenced by:

- Waiting time.
- Correct item retrieval.
- Incorrect retrieval.
- Service quality.
- Queue length.
- Availability of storage.
- Overall operational efficiency.

Consequences:

- Satisfied customers contribute to reputation.
- Impatient customers may leave.
- Incorrect retrieval damages reputation.
- Repeated operational mistakes reduce customer trust.

Avoid excessively punishing the player during early gameplay.

---

## 10. PROGRESSION AND ECONOMY

Create a progression system based on business growth.

The player earns revenue from successful deposits and collections.

Revenue can be used for:

- Storage expansion.
- Equipment.
- Management tools.
- Automation.
- Facility improvements.
- Hiring employees.

Introduce XP for successful operational activities.

Reward:
- Successful customer service.
- Correct item retrieval.
- Efficient storage allocation.
- Customer satisfaction.
- Facility expansion.
- Automation milestones.

Avoid rewarding repetitive actions without meaningful gameplay.

### Upgrade progression

**Stage 1 — Basic Facility**

- One counter.
- Small storage room.
- Limited lockers.
- Unlabelled keys.
- Manual customer memory.

**Stage 2 — Organisation**

- Key labels.
- Locker numbering.
- Physical registers.
- Additional storage.
- Improved shelving.

**Stage 3 — Digitalisation**

- Computer terminal.
- Customer database.
- Digital inventory.
- Search functionality.
- Barcode scanners.
- Digital payments.

**Stage 4 — Mechanisation**

- Conveyor belts.
- Automated sorting.
- Mechanical storage systems.
- Improved item transportation.
- Additional storage floors.

**Stage 5 — Automation**

- Automated locker allocation.
- Robotic retrieval systems.
- Automated item identification.
- Customer self-service terminals.
- Integrated facility management.

**Stage 6 — Enterprise**

- Multiple facilities.
- Large-scale inventory.
- Employee management.
- Advanced logistics.
- Fully automated storage operations.

Every upgrade must have a visible and functional impact.

Do not implement upgrades as purely cosmetic buttons.

---

## 11. AUTOMATION SYSTEM

Automation is a core progression feature.

Each automation upgrade should remove an existing manual task.

Examples:

| Upgrade | Function |
|---|---|
| Key labels | Identify keys faster |
| Locker labels | Locate compartments |
| Notebook | Record customer information |
| Digital database | Search customer records |
| Barcode scanner | Verify deposits |
| Conveyor belt | Transport items |
| Automated allocation | Assign available lockers |
| Robotic retrieval | Retrieve stored belongings |
| Self-service terminal | Reduce counter workload |

Automation should change the player's responsibilities rather than eliminate gameplay.

Introduce new operational challenges as systems become more advanced.

Examples:
- Scanner failures.
- Conveyor jams.
- Incorrect inventory records.
- Equipment maintenance.
- Storage allocation errors.

These should be manageable complications, not constant interruptions.

---

## 12. FACILITY AND ENVIRONMENT DESIGN

The game should initially feature one small, believable locker facility.

### Initial environment

- Customer entrance.
- Service counter.
- Small storage room.
- Locker compartments.
- Key wall.
- Notebook.
- Basic furniture.
- Doors and corridors.

The environment should feel like a real operational business.

### Expansion

The facility physically grows as upgrades are purchased.

New rooms, floors, lockers, equipment and automated systems should become visible.

Do not simply increase an abstract storage capacity number.

Make the business expansion visually rewarding.

---

## 13. CUSTOMER INTERACTION AND UI

The interface should be minimal and intuitive.

### Customer interaction

When a customer approaches, provide an interaction prompt.

The player can:

- Greet the customer.
- Ask their name.
- Accept an item.
- Confirm the deposit.
- Assign a locker.
- Complete the transaction.

When a customer returns:

- Identify the customer.
- Verify the deposit.
- Locate the assigned locker.
- Retrieve the item.
- Complete the collection.

### HUD

Display only useful operational information:

- Current money.
- Customer count.
- Available storage.
- Active deposits.
- Current objective.
- Customer queue.
- Progression and upgrades.

### Management interface

As the player unlocks digital systems, introduce additional interfaces.

The initial game must not expose advanced management tools before they are unlocked.

The interface itself should evolve alongside the facility.

---

## 14. TECHNICAL ARCHITECTURE

Recommended technology:

- React.
- TypeScript.
- Vite.
- Three.js.
- Rapier JS/WASM for selective physics.
- Blender for custom 3D assets.
- GLB/glTF for model delivery.

React should manage:

- Menus.
- HUD.
- Customer dialogue.
- Upgrade interfaces.
- Inventory screens.
- Management systems.

Three.js should manage:

- 3D environment.
- Player movement.
- Camera.
- Customers.
- Lockers.
- Items.
- Physical interactions.
- Animations.
- Rendering.

Keep the game simulation separate from the UI.

### Core systems

Organise the code into independent modules:

- GameManager.
- SimulationClock.
- CustomerManager.
- CustomerScheduler.
- CustomerAI.
- ItemManager.
- InventoryManager.
- LockerManager.
- KeyManager.
- InteractionManager.
- EconomyManager.
- ProgressionManager.
- UpgradeManager.
- AutomationManager.
- FacilityManager.
- SaveManager.

Use TypeScript interfaces and clear data ownership.

Avoid creating one enormous game component.

---

## 15. SCALABILITY AND PERFORMANCE

The game must be designed to scale.

A long-term target is thousands of customer records and storage locations.

Do not render every item, customer or locker as an active 3D object simultaneously.

Use:

- Logical inventory entities.
- Instanced rendering.
- Shared materials.
- Spatial partitioning.
- Object pooling.
- Lazy loading.
- Frustum culling.
- Efficient event scheduling.
- Selective physics.
- Distance-based NPC updates.

The simulation should be capable of managing large inventories without requiring every stored item to exist as a rendered mesh.

Benchmark performance at each expansion milestone.

---

## 16. SAVE SYSTEM

Implement persistent progression.

Save:

- Player progression.
- Money.
- XP.
- Purchased upgrades.
- Facility expansion.
- Customer records.
- Active deposits.
- Locker assignments.
- Automation configuration.

The game should recover correctly after a browser refresh or restart.

Use a versioned save structure to support future changes.

The first playable version should work without authentication or an external backend.

---

## 17. AUDIO AND IMMERSION

Include appropriate environmental audio:

- Door opening and closing.
- Customer footsteps.
- Customer conversations.
- Item placement.
- Locker doors.
- Keys rattling.
- Register and keyboard sounds.
- Barcode scanner.
- Conveyor belts.
- Robotic machinery.
- Payment confirmation.
- Facility ambience.

Audio should evolve as the facility becomes more technologically advanced.

---

## 18. DEVELOPMENT ROADMAP

Build the game in clearly defined milestones.

### Milestone 1 — Core prototype

- Create a small 3D facility.
- Implement player movement.
- Create one customer.
- Implement customer interaction.
- Accept one item.
- Assign one locker.
- Store the item.
- Schedule the customer to return after exactly two minutes.
- Retrieve the correct item.
- Complete the transaction.

This is the most important milestone.

### Milestone 2 — Customer scaling

- Introduce a second customer.
- Random arrival intervals.
- Independent return scheduling.
- Multiple simultaneous deposits.
- Customer patience.
- Queue management.

### Milestone 3 — Manual management

- Unlabelled keys.
- Customer memory.
- Locker identification.
- Manual retrieval.
- Wrong retrieval handling.

### Milestone 4 — Progression

- XP.
- Revenue.
- Upgrade tree.
- Storage expansion.
- Key labels.
- Notebook and registers.

### Milestone 5 — Digitalisation

- Computer interface.
- Searchable database.
- Inventory management.
- Barcode scanning.

### Milestone 6 — Automation

- Conveyor systems.
- Automated storage allocation.
- Robotic retrieval.
- Facility expansion.

### Milestone 7 — Polish

- Improved graphics.
- Animations.
- Audio.
- Performance.
- Save system.
- UI refinement.

---

## 19. DEVELOPMENT RULES

1. Build a working game, not a static visual mockup.
2. Implement actual functionality before adding decorative features.
3. Prioritise the first customer deposit-and-retrieval cycle.
4. Do not prematurely build the 10,000-customer system.
5. Design the underlying architecture to support large-scale growth.
6. Keep customer, inventory and storage data consistent.
7. Make every upgrade functional.
8. Avoid unnecessary complexity in early development.
9. Keep systems modular and maintainable.
10. Test every milestone before moving forward.
11. Do not introduce mechanics that do not contribute to the central management experience.
12. Preserve a playable version throughout development.

---

## 20. FINAL CREATIVE DIRECTION

The game should begin as a simple memory challenge.

The player is personally responsible for every transaction.

As business grows, remembering names and locker assignments becomes increasingly difficult.

The player responds by introducing organisation, tools, digital records and eventually automation.

The transformation should feel substantial:

From manually remembering one customer's suitcase to overseeing an enormous automated storage facility.

The central satisfaction comes from watching a small, chaotic operation become an efficient machine.

**The player doesn't just expand a business. They progressively engineer themselves out of manual labour.**

Build the game around that experience.
