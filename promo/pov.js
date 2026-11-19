// The promo's middle, seen through the player's eyes (song 26.0 → 81.5 s), plus the walk into the climax.
// Load in the game page (?debug=1) with eval(await (await fetch('http://127.0.0.1:5198/pov.js')).text()).
// A beat: { name, start, end, from: [x, z], face: [x, y, z], prep: async (g) => …, steps: [...] }.
// Steps: { walk: [x, z], sprint?, look?: [x, y, z] } · { turn: [x, y, z], dur } · { wait: s } · { act: (g) => … } · { cinema: {...} }.
(() => {
  const FPS = 30
  const SERVER = 'http://127.0.0.1:5198'
  const g = () => __game.sim()
  const player = () => __game.engine.player
  const post = (i, data) => fetch(`${SERVER}/frame?shot=all&i=${i}`, { method: 'POST', body: data })
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))
  const status = { beat: null, frame: 0, done: [], log: [], error: null }
  window.povStatus = status

  /** The yaw and pitch that look at (x, y, z) from the player's eye. */
  function anglesTo(target) {
    const [x, y, z] = typeof target === 'function' ? target() : target
    const e = player().getEyePosition()
    const dx = x - e.x
    const dz = z - e.z
    return [Math.atan2(-dx, -dz), Math.atan2(y - e.y, Math.hypot(dx, dz))]
  }
  /** Turn the head towards angles by at most `rate` rad/s (and ease in). */
  function steer(yaw, pitch, rate, dt) {
    const [y0, p0] = __game.angles()
    const dy = wrap(yaw - y0)
    const dp = pitch - p0
    const k = Math.min(1, dt * 7)
    const sy = Math.sign(dy) * Math.min(Math.abs(dy) * k * 1.4, rate * dt)
    const sp = Math.sign(dp) * Math.min(Math.abs(dp) * k * 1.4, rate * 0.6 * dt)
    __game.aim(y0 + sy, p0 + sp)
    return Math.abs(dy) + Math.abs(dp)
  }
  function setTimeOfDay(t) {
    __game.engine.sky.offset = (((t - g().now / 720 - 0.33) % 1) + 1) % 1
  }

  async function recordBeat(b) {
    status.beat = b.name
    if (b.prep) await b.prep(g())
    setTimeOfDay(b.tod ?? 0.44)
    __game.cinema(null)
    if (b.from) {
      __game.teleport(b.from[0], b.from[1], b.fromY)
      __game.advance(0.1)
    }
    if (b.face) {
      const [yy, pp] = anglesTo(b.face)
      __game.aim(yy, pp)
    }
    __game.drive(0, 0)
    const first = Math.round(b.start * FPS)
    const last = Math.round(b.end * FPS)
    const steps = [...b.steps]
    let cur = null
    let curT = 0
    let turnFrom = null
    const dt = 1 / FPS
    for (let f = first; f < last; f++) {
      // Advance the step machine for this frame.
      for (let guard = 0; guard < 8; guard++) {
        if (!cur) {
          cur = steps.shift() ?? null
          curT = 0
          turnFrom = null
          if (!cur) break
        }
        if (cur.act) {
          try {
            const r = cur.act(g())
            if (r !== undefined) status.log.push([b.name, cur.label ?? '', JSON.stringify(r)?.slice(0, 160)])
          } catch (e) {
            status.log.push([b.name, cur.label ?? '', 'ERR ' + e])
          }
          cur = null
          continue
        }
        if (cur.cinema) {
          const c = cur.cinema
          const t = Math.min(1, curT / c.dur)
          const s = t * t * (3 - 2 * t)
          const lerp = (a, b2) => a.map((v, i) => v + (b2[i] - v) * s)
          __game.cinema(lerp(c.p0, c.p1), lerp(c.l0, c.l1), c.fov ?? 55)
          break
        }
        if (cur.wait !== undefined) {
          if (curT >= cur.wait) {
            cur = null
            continue
          }
          if (cur.look) {
            const [yy, pp] = anglesTo(cur.look)
            steer(yy, pp, 2.5, dt)
          }
          break
        }
        if (cur.turn) {
          const [yy, pp] = anglesTo(cur.turn)
          if (!turnFrom) turnFrom = __game.angles()
          const t = Math.min(1, curT / (cur.dur ?? 0.6))
          const s = t * t * (3 - 2 * t)
          __game.aim(turnFrom[0] + wrap(yy - turnFrom[0]) * s, turnFrom[1] + (pp - turnFrom[1]) * s)
          if (t >= 1) {
            cur = null
            continue
          }
          break
        }
        if (cur.walk) {
          const p = player().getPosition()
          const [tx, tz] = cur.walk
          const d = Math.hypot(tx - p.x, tz - p.z)
          if (d < (cur.near ?? 0.35) || curT > (cur.max ?? 6)) {
            __game.drive(0, 0)
            cur = null
            continue
          }
          const [yy] = anglesTo([tx, 0, tz])
          const pitch = cur.look ? anglesTo(cur.look)[1] : -0.05
          const yaw = cur.look && cur.lookYaw ? anglesTo(cur.look)[0] : yy
          steer(yaw, pitch, 3.2, dt)
          // Only walk once roughly facing the way (so you never sidestep through a door frame).
          const off = Math.abs(wrap(yy - __game.angles()[0]))
          __game.drive(off < 0.9 ? 1 : 0.2, 0, !!cur.sprint && off < 0.4)
          break
        }
        cur = null
      }
      curT += dt
      status.frame = f
      await post(f, __game.frame(dt, 0.9))
    }
    __game.drive(0, 0)
    __game.cinema(null)
    status.done.push(b.name)
  }

  // ------------------------------------------------------------------ the beats

  const interact = (label) => ({ label, act: () => __game.interact().result?.message ?? 'no target' })

  const BEATS = [
    {
      // Holding Maya's bag at the counter: turn round, through the partition, to the locker; open it, put it in, shut it, take the key.
      name: 'deposit', start: 26.0, end: 30.6, tod: 0.38, from: [0.2, 0.3], face: [0, 1.6, 2.05],
      steps: [
        { wait: 0.25 },
        { turn: [0.3, 1.4, -4], dur: 0.45 },
        { walk: [0.1, -3.2], sprint: true },
        { walk: [0.95, -6.9], sprint: true, near: 0.3 },
        { turn: [0.95, 1.0, -9], dur: 0.25 },
        { label: 'open', act: (gm) => gm.openLocker('locker-6').message },
        { wait: 0.4 },
        { label: 'store', act: (gm) => gm.putItem('locker-6').message },
        { wait: 0.35 },
        { label: 'close', act: (gm) => gm.closeLocker('locker-6').message },
        { wait: 0.25 },
        { turn: [1.31, 1.2, -8.4], dur: 0.2 },
        { label: 'key', act: (gm) => gm.takeKeyFromLock('locker-6').message },
        { wait: 1 },
      ],
    },
    {
      // Hang the key on the board.
      name: 'hang-key', start: 30.6, end: 32.1, from: [-2.3, -1.0], face: [-1.6, 1.3, -2.4],
      steps: [{ turn: [-2.44, 1.45, -2.4], dur: 0.35 }, { wait: 0.2 }, { label: 'hang', act: (gm) => gm.hangKey(0).message }, { wait: 1 }],
    },
    {
      // Back at the counter: a crowd.
      name: 'crowd', start: 32.1, end: 36.0, from: [2.4, 0.25], face: [-4, 1.55, 3.4],
      steps: [{ turn: [-3.5, 1.5, 3.6], dur: 0.3 }, { turn: [1.2, 1.5, 4.0], dur: 3.2 }, { wait: 1 }],
    },
    {
      // To the catalogue desk: buy the deposit register (toast in the edit).
      name: 'catalogue', start: 36.0, end: 39.7, from: [2.6, 0.2], face: [4.6, 1.4, -0.6],
      steps: [
        { walk: [4.55, -0.6], near: 0.25 },
        { turn: [4.75, 0.82, -1.9], dur: 0.35 },
        { wait: 1.1 },
        { label: 'buy register', act: (gm) => gm.grantUpgrade('register') },
        { wait: 2 },
      ],
    },
    {
      // The board in the storage room.
      name: 'board', start: 39.7, end: 42.4, from: [1.2, -7.4], face: [0, 1.4, -9],
      steps: [{ turn: [3.4, 1.7, -2.5], dur: 0.8 }, { walk: [3.3, -4.6], near: 0.3, look: [3.4, 1.7, -2.5], lookYaw: true }, { wait: 2 }],
    },
    {
      // Floor 1: up the stairs from the south hall.
      name: 'floor1', start: 42.4, end: 46.8, from: [3.0, -12.2], face: [5.25, 1.2, -16.5],
      steps: [
        { walk: [5.25, -16.6], sprint: true, near: 0.4 },
        { turn: [5.25, 3.2, -10], dur: 0.35 },
        { walk: [5.25, -10.2], sprint: true, near: 0.5, max: 3 },
        { turn: [-5, 4.4, -10.9], dur: 0.7 },
        { wait: 2 },
      ],
    },
    {
      // Automation: load the bag on the belt and watch the arm take it.
      name: 'conveyor', start: 46.8, end: 51.5, from: [-5.05, -0.2], face: [-5.05, 0.6, -1.5],
      steps: [
        { wait: 0.3 },
        interact('load belt'),
        { wait: 0.35 },
        { turn: [0, 1.5, -2.4], dur: 0.35 },
        { walk: [0, -2.9], sprint: true, near: 0.35 },
        { walk: [-1.0, -5.2], sprint: true, near: 0.4 },
        { turn: [-4.2, 1.1, -7.2], dur: 0.4 },
        { wait: 3, look: [-4.0, 1.1, -7.4] },
      ],
    },
    {
      // The warehouse: through the south hall's door into the shed, robots at work.
      name: 'warehouse', start: 51.5, end: 55.4, from: [3.6, -18.2], face: [8, 1.5, -18.2],
      steps: [{ walk: [7.6, -18.2], sprint: true, near: 0.4 }, { walk: [10.2, -18.4], sprint: true, near: 0.4 }, { turn: [22, 1.2, -18.8], dur: 0.5 }, { wait: 3, look: [22, 1.2, -19] }],
    },
    {
      // The vault: open the hatch and climb down.
      name: 'vault', start: 55.4, end: 56.5, from: [9.4, -25.4], face: [9.4, 0, -27],
      steps: [{ wait: 0.1 }, { label: 'open hatch', act: (gm) => { gm.vaultHatchOpen = true } }, { wait: 2, look: [9.4, -1.5, -27.1] }],
    },
    {
      // Down in the vault: the rack of contraband, the lamp-lit table.
      name: 'vault-in', start: 56.5, end: 57.5, from: [9.4, -27.05], fromY: -3.2, face: [9.4, -2.6, -29],
      steps: [{ turn: [7.8, -2.3, -30.2], dur: 0.9 }, { wait: 1 }],
    },
    {
      // The shady contact by the door.
      name: 'contact', start: 57.5, end: 59.6, from: [9.9, -15.9], fromY: 0, face: [6.95, 1.6, -16.5],
      prep: () => { __game.engine.climb = null },
      steps: [{ wait: 2.2, look: [6.95, 1.5, -16.5] }],
    },
    {
      // A kei truck drifts into the dock (prep times it).
      name: 'kei', start: 59.6, end: 63.6, from: [31.5, -4.2], face: [32, 1.2, -12],
      steps: [{ wait: 4, look: () => {
        const v = __game.engine.warehouse?.trucks.get(window.keiId)
        return v ? [v.group.position.x, 1.0, v.group.position.z] : [28, 1, -14]
      } }],
    },
    {
      // B-roll: cars drifting round the roundabout.
      name: 'roundabout', start: 63.6, end: 67.6,
      steps: [{ cinema: { p0: [-37, 4.2, 5], p1: [-41, 4.6, 8.8], l0: [-48, 0, 15], l1: [-49, 0, 15.5], dur: 4, fov: 55 } }],
    },
    {
      // The deal room: in through the office door, the VIP waiting behind the desk, sign.
      name: 'deal', start: 67.6, end: 71.2, from: [4.4, 2.4], face: [8, 1.6, 2.4],
      steps: [
        { walk: [9.0, 2.4], near: 0.35, look: [11.2, 1.5, 2.4], lookYaw: true },
        { turn: [11.2, 1.35, 2.4], dur: 0.3 },
        { wait: 3, look: [11.2, 1.35, 2.4] },
        { label: 'sign', act: (gm) => (gm.openDeal(), gm.chooseDeal('accept')) },
        { wait: 1 },
      ],
    },
    {
      // The docks: along the jetty with the ship at the berth and the boats in.
      name: 'docks', start: 71.2, end: 76.6, from: [-16.5, -17.3], face: [-30, 1.5, -20],
      steps: [{ walk: [-27, -17.3], near: 0.5, look: [-33, 4, -40], lookYaw: false }, { turn: [-34, 5, -42], dur: 1 }, { wait: 2 }],
    },
  ]

  // The walk into the climax (recorded in the climax's own session, before the director's S3 shots).
  const LEAD = {
    name: 'dusk-walk', start: 76.6, end: 81.5, tod: 0.728, from: [18, 19.2], face: [0, 1.7, 19.2],
    steps: [{ walk: [9.5, 19.2], near: 0.4 }, { turn: [-101.8, 95.2, -87], dur: 1.4 }, { wait: 3, look: [-101.8, 95.2, -87] }],
  }

  window.pov = {
    BEATS,
    LEAD,
    recordBeat,
    async run(names) {
      try {
        for (const b of BEATS) if (!names || names.includes(b.name)) {
          await recordBeat(b)
        }
        status.beat = 'finished'
      } catch (e) {
        status.error = String(e && e.stack ? e.stack : e)
      }
    },
    anglesTo,
    status,
  }
})()
