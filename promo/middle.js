// Records the whole first-person middle (26.0 → 76.6 s) in one fresh game, in order, setting up each beat's state off camera.
// Needs pov.js loaded first. Start with: window.middleJob = middle(); then poll window.middleStatus.
window.middle = async () => {
  const st = (window.middleStatus = { stage: 'start', error: null })
  const g = () => __game.sim()
  const beat = (name) => pov.BEATS.find((b) => b.name === name)
  const offCamera = (seconds, step = 1) => {
    __game.cinema([0, 30, 30], [0, 0, 0], 55)
    for (let t = 0; t < seconds; t += step) __game.advance(step)
    __game.cinema(null)
  }
  const until = (cond, max, step = 0.5) => {
    __game.cinema([0, 30, 30], [0, 0, 0], 55)
    let t = 0
    while (!cond() && t < max) {
      __game.advance(step)
      t += step
    }
    __game.cinema(null)
    return cond()
  }
  try {
    __game.filmSize(1920, 1080)
    __game.mod({ type: 'patience', on: true })
    __game.advance(15)
    // Maya at the counter: take her bag.
    __game.teleport(0, 0.3)
    __game.advance(0.3)
    __game.face(0, 2.05)
    __game.advance(0.05)
    __game.interact()
    g().choose('greet')
    g().choose('askName')
    g().choose('accept')
    g().closeDialogue()
    st.stage = 'deposit'
    await pov.recordBeat(beat('deposit'))
    await pov.recordBeat(beat('hang-key'))
    const maya = g().customers.all()[0]
    g().talkTo(maya.id)
    g().choose('confirmStored')
    g().closeDialogue()

    st.stage = 'crowd'
    __game.mod({ type: 'spawn', count: 7 })
    offCamera(18)
    await pov.recordBeat(beat('crowd'))
    await pov.recordBeat(beat('catalogue'))
    await pov.recordBeat(beat('board'))

    st.stage = 'floor1'
    g().grantUpgrade('southExpansion')
    g().grantUpgrade('floor1')
    offCamera(8)
    __game.teleport(3, -12.2, 0)
    __game.advance(0.2)
    await pov.recordBeat(beat('floor1'))

    st.stage = 'conveyor'
    g().grantUpgrade('conveyor')
    __game.teleport(0, 0.3, 0)
    offCamera(6)
    const c = g().customers.all().find((x) => x.state === 'waiting')
    if (c) {
      g().talkTo(c.id)
      g().choose('greet')
      g().choose('accept')
      g().closeDialogue()
    }
    await pov.recordBeat(beat('conveyor'))

    st.stage = 'warehouse'
    g().grantUpgrade('warehouse')
    g().grantUpgrade('wh-hidden-1')
    offCamera(14)
    await pov.recordBeat(beat('warehouse'))
    __game.engine.climb = null
    g().vaultHatchOpen = false
    __game.teleport(9.4, -25.4, 0)
    __game.advance(0.4)
    await pov.recordBeat(beat('vault'))
    __game.engine.climb = null
    await pov.recordBeat(beat('vault-in'))

    st.stage = 'contact'
    __game.engine.climb = null
    __game.teleport(9.9, -15.9, 0)
    __game.advance(0.2)
    const w = g().warehouse
    if (!w.contact) w.nextContactAt = g().now + 0.3
    until(() => w.contact && w.contact.phase === 'asking' && w.contact.t > 1.5, 60)
    await pov.recordBeat(beat('contact'))

    st.stage = 'kei'
    __game.teleport(32.5, -31, 0)
    let kei = null
    until(() => (kei = g().warehouse.trucks.find((t) => t.kind === 'kei' && t.phase === 'arriving' && t.t < 11.5)), 600, 0.25)
    if (kei) {
      while (kei.t < 12.2) __game.advance(1 / 30)
      window.keiId = kei.id
      await pov.recordBeat({ ...beat('kei'), from: [32.5, -31], face: [36, 1.2, -8] })
    } else st.noKei = true

    st.stage = 'roundabout'
    await pov.recordBeat(beat('roundabout'))

    st.stage = 'deal'
    g().grantUpgrade('office')
    g().economy.reputation = 92
    offCamera(4)
    if (!g().deals.offer) g().deals.nextAt = g().now
    offCamera(1)
    const offer = g().deals.offer
    if (offer) {
      until(() => g().now >= offer.readyAt + 3, 120)
      __game.teleport(4.4, 2.4, 0)
      __game.advance(0.1)
      await pov.recordBeat(beat('deal'))
      g().openDeal()
      g().chooseDeal('accept')
    } else st.noOffer = true

    st.stage = 'docks'
    g().grantUpgrade('lake-harbour')
    until(() => g().harbour.ship && g().now > g().harbour.ship.mooredAt + 8, 240)
    __game.teleport(-16.5, -17.3, 0)
    __game.advance(0.2)
    await pov.recordBeat(beat('docks'))
    st.stage = 'finished'
  } catch (e) {
    st.error = String(e && e.stack ? e.stack : e)
  }
}
