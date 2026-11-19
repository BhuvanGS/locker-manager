// Promo shot list and recorder. Runs in the game page (?debug=1): loaded with eval(await fetch(...)).
// Times are seconds from 0:55 in the song. Each shot: [name, start, end, session, timeOfDay, p0, p1, l0, l1, fov].
// Sessions: S1 = the full facility before the meteor; S2 = after it, with the harbour; S3 = the strike itself (one continuous run).
(() => {
  const FPS = 30
  const SERVER = 'http://127.0.0.1:5198'
  const crater = [-36, 0, -24]
  // Where the meteor comes from (Lake: DIR × START from the crater), well up in the sky.
  const sky = (k) => [-36 - 0.47 * k, 0.68 * k, -24 - 0.45 * k]

  const SHOTS = [
    // A. Quiet, sneaking: night falls on the shop, then dawn.
    ['front-night', 0, 7.06, 'S1', 0.93, [0, 1.7, 19.4], [0, 2.0, 12.5], [0, 2.8, 5], [0, 2.8, 5], 50],
    ['lobby-night', 7.06, 11.58, 'S1', 0.95, [-4.7, 1.65, 5.5], [-1.6, 1.65, 4.7], [1, 1.15, 0.6], [1.6, 1.15, 0.4], 55],
    ['storage-night', 11.58, 16.1, 'S1', 0.97, [4.6, 1.9, -3.3], [-1.4, 1.9, -3.3], [-0.5, 1.3, -9], [-1.5, 1.3, -9], 55],
    ['beach-dawn', 16.1, 21.62, 'S1', 0.255, [-66, 1.0, 34], [-66, 1.5, 20], [-46, 3, 10], [-44, 3, 8], 55],
    ['street-dawn', 21.62, 26.0, 'S1', 0.29, [14, 0.55, 9.9], [22, 0.6, 9.9], [40, 0.9, 14], [46, 0.9, 14], 50],
    // B. Building up: the automated facility by day.
    ['conveyor', 26.0, 32.08, 'S1', 0.4, [3.6, 2.4, -3.0], [1.2, 2.1, -4.4], [-3.6, 0.9, -6.4], [-3.2, 0.9, -8.2], 62],
    ['south-hall', 32.08, 35.98, 'S1', 0.42, [5.2, 2.1, -10.4], [-3.2, 2.1, -10.4], [-1, 1.0, -18], [-2, 1.0, -18], 60],
    ['yard', 35.98, 39.74, 'S1', 0.43, [41, 5, -4], [37, 6.5, -11], [25, 1.5, -18], [25, 1.5, -22], 55],
    ['warehouse-in', 39.74, 42.44, 'S1', 0.44, [8, 4.6, -11], [12.5, 4.4, -11.2], [18, 1, -24], [20, 1, -24], 60],
    ['checkpost', 42.44, 46.84, 'S1', 0.45, [47.6, 1.5, -53], [46.4, 1.7, -58], [45, 2.2, -66], [45, 2.4, -70], 55],
    // C. Full orchestra: everything at once, cut on the beat.
    ['roundabout', 46.84, 49.3, 'S1', 0.46, [-37, 4.2, 5], [-40, 4.4, 8.5], [-48, 0, 15], [-49, 0, 15], 55],
    ['harbour-crane', 49.3, 51.5, 'S2', 0.47, [-8, 17, -16], [-13, 15.5, -23], [-33, 4, -48], [-35, 4, -50], 55],
    ['park-fountain', 51.5, 53.16, 'S1', 0.48, [69, 2.3, -15], [72.5, 2.0, -18.5], [78, 1.5, -24], [78, 1.6, -24], 55],
    ['harbour-ship', 53.16, 55.42, 'S2', 0.48, [-42, 3, -22], [-37, 3.2, -24], [-33, 5, -44], [-32, 5, -44], 55],
    ['beach-huts', 55.42, 57.5, 'S1', 0.49, [-54, 2.2, 16.0], [-54, 2.2, 13.0], [-60, 1.4, 9.5], [-60, 1.4, 8.5], 55],
    ['shop-orbit', 57.5, 59.6, 'S1', 0.5, [14, 9, 16.5], [-14, 9, 16.5], [0, 2, 2], [0, 2, 2], 55],
    ['pitch', 59.6, 61.6, 'S1', 0.5, [66, 3.2, -43], [71, 3.2, -43], [78, 0, -65], [80, 0, -65], 55],
    ['harbour-gantry', 61.6, 63.6, 'S2', 0.51, [-27, 11, -76], [-34, 11, -76], [-39, 3, -58], [-41, 3, -58], 55],
    ['tunnel-east', 63.6, 65.6, 'S1', 0.52, [94, 1.5, 12.8], [100, 1.5, 13.6], [110, 2.6, 14.2], [112, 2.6, 14.2], 55],
    ['lobby-day', 65.6, 67.6, 'S1', 0.53, [2.6, 1.6, 5.5], [-2.2, 1.6, 5.5], [0, 1.25, 0.8], [0, 1.25, 0.8], 58],
    ['yard-high', 67.6, 69.4, 'S1', 0.54, [31, 14, 1], [35, 14, -6], [24, 0, -20], [24, 0, -22], 55],
    ['harbour-tugs', 69.4, 71.2, 'S2', 0.55, [-61, 6, -8], [-61, 6, -15], [-45, 0, -26], [-45, 0, -28], 55],
    ['parasols', 71.2, 73.0, 'S1', 0.56, [-67, 1.2, 25], [-67, 1.2, 32], [-62, 1, 29], [-62, 1, 35], 55],
    ['playground', 73.0, 74.8, 'S1', 0.57, [85, 1.6, -26.5], [87, 1.6, -27.5], [91, 1, -33], [91, 1, -34], 55],
    ['seafront-high', 74.8, 76.6, 'S1', 0.58, [-29, 12, 23], [-36, 12, 23], [-52, 0, 10], [-52, 0, 10], 55],
    ['street-rush', 76.6, 78.2, 'S1', 0.59, [-24, 0.6, 14.95], [6, 0.6, 14.95], [40, 0.8, 14.95], [60, 0.8, 14.95], 62],
    ['aerial-town', 78.2, 80.4, 'S1', 0.6, [-6, 22, 17], [10, 26, 15], [10, 0, -18], [14, 0, -20], 60],
    ['harbour-close', 80.4, 81.5, 'S2', 0.61, [-22, 9, -30], [-24, 9.5, -31], [-34, 8, -46], [-34, 8, -46], 50],
    // D. The climax: dusk, a star brightening, the strike on the last crash, the lobby roof blown open, the title.
    ['sky-street', 81.5, 85.6, 'S3', 0.735, [10, 1.6, 19.2], [9, 1.6, 19.2], sky(140), sky(150), 55],
    ['sky-plaza', 85.6, 89.7, 'S3', 0, [-41.5, 1.6, 3.2], [-42.5, 1.7, 2.6], sky(120), sky(110), 55],
    ['sky-close', 89.7, 92.8, 'S3', 0, [2, 1.7, 13], [2, 1.7, 12.5], sky(90), sky(60), 40],
    ['fall', 92.8, 94.8, 'S3', 0, [-58, 2.2, 8], [-58, 2.4, 7], [-36, 4, -24], [-36, 2, -24], 60],
    ['roof', 94.8, 97.6, 'S3', 0, [6.5, 8.5, 13], [6, 9.5, 13.5], [0, 3.2, 3.5], [0, 4.5, 3.5], 55],
    ['title', 97.6, 104.0, 'S3', 0, [-14, 22, 14], [-4, 32, 32], crater, crater, 55],
  ]

  const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t)
  const ease = (t) => t * t * (3 - 2 * t)
  const status = { shot: null, frame: 0, done: [], error: null }
  window.filmStatus = status

  function setTimeOfDay(t) {
    const g = __game.sim()
    const skyObj = __game.engine.sky
    skyObj.offset = (((t - g.now / 720 - 0.33) % 1) + 1) % 1
  }

  async function post(name, i, data) {
    await fetch(`${SERVER}/frame?shot=${name}&i=${i}`, { method: 'POST', body: data })
  }

  async function record(shot, folder = 'all') {
    const [name, start, end, , tod, p0, p1, l0, l1, fov] = shot
    if (tod) setTimeOfDay(tod)
    const first = Math.round(start * FPS)
    const last = Math.round(end * FPS)
    status.shot = name
    for (let f = first; f < last; f++) {
      const t = ease((f - first) / Math.max(1, last - first - 1))
      __game.cinema(lerp(p0, p1, t), lerp(l0, l1, t), fov)
      status.frame = f
      await post(folder, f, __game.frame(1 / FPS, 0.9))
    }
    status.done.push(name)
  }

  window.film = {
    SHOTS,
    async setup(session) {
      __game.filmSize(1920, 1080)
      __game.mod({ type: 'patience', on: true })
      if (session === 'S1' || session === 'S3') {
        __game.mod({ type: 'unlockAll' })
        __game.mod({ type: 'spawn', count: 6 })
      }
      if (session === 'S2') __game.sim().grantUpgrade('lake-harbour')
      __game.cinema([0, 30, 30], [0, 0, 0], 55)
      // Let everything settle in: new rooms rise, trucks and robots get going, customers arrive.
      for (let i = 0; i < 6; i++) __game.advance(5)
    },
    /** Record every shot of a session (S3: the meteor is timed to strike at 94.8 s on the song's clock). */
    async run(session, only) {
      try {
        const list = SHOTS.filter((s) => s[3] === session && (!only || only.includes(s[0])))
        if (session === 'S3') {
          const g = __game.sim()
          const startT = list[0][1]
          g.meteor.start(g.now)
          g.meteor.hurry(g.now, 94.8 - startT)
          setTimeOfDay(list[0][4])
          for (const s of list) await record([...s.slice(0, 4), 0, ...s.slice(5)])
        } else {
          for (const s of list) await record(s)
        }
        status.shot = 'finished'
      } catch (e) {
        status.error = String(e && e.stack ? e.stack : e)
      }
    },
    /** One still of a shot (its middle frame) for checking framing: saved as stills/<name>. */
    async still(name, at = 0.5) {
      const s = SHOTS.find((x) => x[0] === name)
      const [, , , , tod, p0, p1, l0, l1, fov] = s
      if (tod) setTimeOfDay(tod)
      const t = ease(at)
      __game.cinema(lerp(p0, p1, t), lerp(l0, l1, t), fov)
      for (let i = 0; i < 3; i++) __game.frame(1 / FPS, 0.1)
      await post('stills', SHOTS.indexOf(s), __game.frame(1 / FPS, 0.85))
    },
  }
})()
