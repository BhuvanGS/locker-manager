import * as THREE from 'three'
import { HeadBubble } from './HeadBubble'
import { makeCruiser, makeOfficer, makePerson } from './models'
import { segmentHitsOccluder } from './occlusion'
import type {
  CopState,
  DialogueLine,
  DialogueOption,
  DialogueView,
  NeighbourObservation,
  Occluder,
  PlayerReport,
} from './types'

type Activity = 'porch' | 'mail' | 'walk' | 'garden'
type Concern = 'routine' | 'approach' | 'asking' | 'leaving'

type Resident = {
  name: string
  color: number
  mesh: THREE.Group
  home: THREE.Vector3
  mail: THREE.Vector3
  garden: THREE.Vector3
  walkA: THREE.Vector3
  walkB: THREE.Vector3
  activity: Activity
  phaseEnds: number
  walkTarget: THREE.Vector3
  concern: Concern
  approachPoint: THREE.Vector3
  askUntil: number
  approachStarted: number
  memory: number
  greetings: number
  explanations: number
  sawWalk: boolean
  sawCrawl: boolean
  sawNear: boolean
  lines: DialogueLine[]
  bubble: HeadBubble
  cooldownUntil: number
}

const ACTIVITIES: Activity[] = ['porch', 'mail', 'walk', 'garden']
const SIDEWALK_Z = 12.4
const VIEW_RANGE = 16
const CONE = Math.cos(THREE.MathUtils.degToRad(58))
const COME_OVER = 20
const CALL_COPS = 45
const MAX_LINES = 4

/** Walk up to someone and they will hear you within this distance. */
const TALK_RANGE = 4.5
/** A neighbour who came over to ask can be answered from a little further away. */
const ASK_RANGE = 7
/** Walk this far away and the conversation closes. */
const CONVO_DROP = 8.5

const COP_HEAR_RANGE = 6
const COP_SHOW_RANGE = 10
const QUESTION_RANGE = 2.6
const QUESTION_TIMEOUT = 15
const PROVE_TIME = 60
const PROVE_TIME_WITH_KEY = 25
const ARREST_DELAY = 1.8
const COP_WALK = 2.8
const COP_RUN = 6.6
const COP_PATH = [
  new THREE.Vector3(20, 0, 18),
  new THREE.Vector3(0, 0, 18),
  new THREE.Vector3(0, 0, 13.1),
]

export class NeighbourDirector {
  private readonly residents: Resident[] = []
  private readonly occluders: Occluder[]
  private readonly look = new THREE.Vector3()
  private elapsed = 0
  private suspicion = 0
  private crouchHeld = 0
  private alertName: string | null = null

  private convo: Resident | null = null

  private copsCalled = false
  private cop: THREE.Group | null = null
  private cruiser: THREE.Group | null = null
  private copBubble: HeadBubble | null = null
  private copState: CopState = 'none'
  private copPoint = 0
  private copLines: DialogueLine[] = []
  private copDeadline = 0
  private copStrikes = 0
  private arrestAt = 0
  private busted = false
  private bustReason: string | null = null

  private viewSig = ''
  private view: DialogueView | null = null

  constructor(parent: THREE.Group, occluders: Occluder[]) {
    this.occluders = occluders
    const specs: Pick<Resident, 'name' | 'color' | 'home' | 'mail' | 'garden' | 'walkA' | 'walkB'>[] = [
      {
        name: 'Mrs. Hale',
        color: 0xc4b5fd,
        home: new THREE.Vector3(-16, 0, 23.2),
        mail: new THREE.Vector3(-13.2, 0, 14.2),
        garden: new THREE.Vector3(-12.5, 0, 23.4),
        walkA: new THREE.Vector3(-18, 0, 12.6),
        walkB: new THREE.Vector3(-6, 0, 12.6),
      },
      {
        name: 'Mr. Okonkwo',
        color: 0x93c5fd,
        home: new THREE.Vector3(16, 0, 23.2),
        mail: new THREE.Vector3(13.2, 0, 14.2),
        garden: new THREE.Vector3(12.5, 0, 23.4),
        walkA: new THREE.Vector3(6, 0, 12.6),
        walkB: new THREE.Vector3(18, 0, 12.6),
      },
      {
        name: 'Samir',
        color: 0xfda4af,
        home: new THREE.Vector3(-20, 0, 33.6),
        mail: new THREE.Vector3(-15, 0, 14.2),
        garden: new THREE.Vector3(-24, 0, 32),
        walkA: new THREE.Vector3(-20, 0, 12.6),
        walkB: new THREE.Vector3(-10, 0, 12.6),
      },
    ]

    for (const spec of specs) {
      const mesh = makePerson(spec.color)
      mesh.position.copy(spec.home)
      parent.add(mesh)
      this.residents.push({
        ...spec,
        mesh,
        activity: 'porch',
        phaseEnds: 12 + Math.random() * 10,
        walkTarget: spec.walkB.clone(),
        concern: 'routine',
        approachPoint: spec.walkA.clone(),
        askUntil: 0,
        approachStarted: 0,
        memory: 0,
        greetings: 0,
        explanations: 0,
        sawWalk: false,
        sawCrawl: false,
        sawNear: false,
        lines: [],
        bubble: new HeadBubble(mesh, '#c4b5fd'),
        cooldownUntil: 0,
      })
    }
  }

  reset(): void {
    this.elapsed = 0
    this.suspicion = 0
    this.crouchHeld = 0
    this.alertName = null
    this.convo = null
    this.copsCalled = false
    this.copState = 'none'
    this.copPoint = 0
    this.copLines = []
    this.copDeadline = 0
    this.copStrikes = 0
    this.arrestAt = 0
    this.busted = false
    this.bustReason = null
    this.viewSig = ''
    this.view = null
    if (this.cop) this.cop.visible = false
    if (this.cruiser) this.cruiser.visible = false
    this.copBubble?.hide()
    for (const resident of this.residents) {
      resident.concern = 'routine'
      resident.memory = 0
      resident.greetings = 0
      resident.explanations = 0
      resident.sawWalk = false
      resident.sawCrawl = false
      resident.sawNear = false
      resident.lines = []
      resident.cooldownUntil = 0
      resident.bubble.hide()
      resident.mesh.position.copy(resident.home)
    }
  }

  update(dt: number, report: PlayerReport): NeighbourObservation {
    this.elapsed += dt
    if (report.crouching) this.crouchHeld += dt
    else this.crouchHeld = 0
    this.remember(dt, report)
    this.handleSpeech(report)
    if (!this.copsCalled) this.maybeStartConcern(report.position)
    this.stepResidents(dt, report.position)
    this.updateCop(dt, report)
    this.updateConversation(report.position)
    this.refreshBubbles(report.position)
    return this.observe(report)
  }

  // ------------------------------------------------------------ what the HUD sees

  private observe(report: PlayerReport): NeighbourObservation {
    const view = this.currentView(report.position)
    const sig = view ? JSON.stringify(view) : ''
    if (sig !== this.viewSig) {
      this.viewSig = sig
      this.view = view
    }
    const target = !this.view && !this.busted ? this.talkTarget(report.position) : null
    return {
      dialogue: this.view,
      suspicion: this.suspicion,
      alertName: this.suspicion >= 1 ? this.alertName : null,
      copsCalled: this.copsCalled,
      copState: this.copState,
      copTimer: this.copState === 'waiting' ? Math.max(0, Math.ceil(this.copDeadline - this.elapsed)) : null,
      busted: this.busted,
      bustReason: this.bustReason,
      talkPrompt: target ? `[G] Greet ${target.name} · [X] Explain you're locked out` : null,
    }
  }

  private currentView(playerPos: THREE.Vector3): DialogueView | null {
    if (this.copLines.length > 0 && this.copNear(playerPos, COP_SHOW_RANGE)) {
      return {
        speaker: 'Officer',
        tone: 'police',
        lines: this.copLines.slice(-MAX_LINES),
        options: this.copOptions(),
      }
    }
    const resident = this.convo
    if (!resident || resident.lines.length === 0) return null
    return {
      speaker: resident.name,
      tone: 'neighbour',
      lines: resident.lines.slice(-MAX_LINES),
      options: this.copsCalled
        ? []
        : [
            { key: 'G', label: resident.greetings === 0 ? 'Say hello' : 'Say hello again' },
            {
              key: 'X',
              label: resident.explanations === 0 ? "Explain you're locked out" : 'Explain it again',
            },
          ],
    }
  }

  private copOptions(): DialogueOption[] {
    if (this.copState === 'questioning') {
      return [
        { key: 'X', label: '"It\'s my house — I\'m locked out."' },
        { key: 'G', label: '"Evening, officer."' },
      ]
    }
    return []
  }

  // ------------------------------------------------------------ talking

  private handleSpeech(report: PlayerReport): void {
    if (!report.greet && !report.explain) return
    if (this.copHears(report)) return
    const target = this.talkTarget(report.position)
    if (!target) return
    this.convo = target

    if (this.copsCalled) {
      say(target, 'You', report.explain ? "It's my house, honestly." : 'Hey.')
      say(target, target.name, 'Tell it to the police.')
      return
    }

    if (report.explain) {
      target.explanations += 1
      say(
        target,
        'You',
        target.explanations === 1
          ? 'I locked myself out. The key is in one of these rocks.'
          : 'Like I said, the key is in the gravel.',
      )
      if (target.explanations === 1) {
        target.memory = Math.max(0, target.memory - 15)
        say(target, target.name, 'Locked out? Alright. Be quick about it.')
      } else {
        this.addMemory(target, target.explanations === 2 ? 30 : 45)
        say(target, target.name, "You've told me that already.")
      }
    } else {
      target.greetings += 1
      say(target, 'You', target.greetings === 1 ? 'Hey. Everything is alright.' : 'Hey again.')
      if (target.greetings === 1) {
        target.memory = Math.max(0, target.memory - 5)
        say(target, target.name, 'Afternoon.')
      } else {
        this.addMemory(target, target.greetings === 2 ? 20 : 35)
        say(target, target.name, "You don't need to keep saying hello.")
      }
    }
    this.recomputeSuspicion()
    if (target.memory >= CALL_COPS) this.callCops(target)
  }

  /** Nearest resident close enough to hear you, with nothing solid in between. */
  private talkTarget(playerPos: THREE.Vector3): Resident | null {
    let best: Resident | null = null
    let bestDist = Infinity
    for (const resident of this.residents) {
      const visiting = resident.concern === 'approach' || resident.concern === 'asking'
      const range = visiting ? ASK_RANGE : TALK_RANGE
      const dist = flatDistance(resident.mesh.position, playerPos)
      if (dist > range || dist >= bestDist) continue
      if (this.blocked(resident.mesh.position, playerPos)) continue
      best = resident
      bestDist = dist
    }
    return best
  }

  private updateConversation(playerPos: THREE.Vector3): void {
    if (this.convo && flatDistance(this.convo.mesh.position, playerPos) > CONVO_DROP) {
      this.endConversation()
    }
    if (this.convo) return
    // A neighbour who walked over to ask opens the conversation themselves.
    for (const resident of this.residents) {
      if (resident.concern !== 'asking' || resident.lines.length === 0) continue
      if (flatDistance(resident.mesh.position, playerPos) > ASK_RANGE) continue
      if (this.blocked(resident.mesh.position, playerPos)) continue
      this.convo = resident
      return
    }
  }

  private endConversation(): void {
    const resident = this.convo
    this.convo = null
    if (resident && resident.concern === 'routine') resident.lines = []
  }

  // ------------------------------------------------------------ suspicion

  private remember(dt: number, report: PlayerReport): void {
    const crawling = report.onGravel && this.crouchHeld > 0.85
    const leftArea = Math.abs(report.position.x) > 26 || report.position.z < -12 || report.position.z > 34
    for (const resident of this.residents) {
      const sees = this.canSee(resident.mesh, report.position)
      if (!report.onGravel) resident.sawWalk = false
      if (!crawling) resident.sawCrawl = false
      const nearProperty = this.nearProperty(resident, report.position)
      if (!nearProperty) resident.sawNear = false
      // Once the police are here, it is their call — neighbours stop escalating.
      if (sees && !this.copsCalled) {
        if (report.onGravel && report.speed > 0.45 && !resident.sawWalk) {
          resident.sawWalk = true
          this.addMemory(resident, 1)
        }
        if (report.pickedRock) this.addMemory(resident, 5)
        if (crawling && !resident.sawCrawl) {
          resident.sawCrawl = true
          this.addMemory(resident, 10)
        }
        if (nearProperty && (report.holdingRock || report.crouching || report.onGravel) && !resident.sawNear) {
          resident.sawNear = true
          this.addMemory(resident, 15)
        }
      }
      if (leftArea && resident.memory > 0) {
        resident.memory = Math.max(0, resident.memory - dt * 0.45)
      }
    }
    const top = this.recomputeSuspicion()
    if (top && top.memory >= CALL_COPS) this.callCops(top)
  }

  private recomputeSuspicion(): Resident | null {
    let top: Resident | null = null
    for (const resident of this.residents) {
      if (!top || resident.memory > top.memory) top = resident
    }
    this.suspicion = top?.memory ?? 0
    this.alertName = top && top.memory >= 1 ? top.name : null
    return top
  }

  private addMemory(resident: Resident, amount: number): void {
    resident.memory = Math.max(0, Math.min(80, resident.memory + amount))
  }

  private nearProperty(resident: Resident, playerPos: THREE.Vector3): boolean {
    const dx = playerPos.x - resident.home.x
    const dz = playerPos.z - resident.home.z
    if (dx * dx + dz * dz < 8 * 8) return true
    const gx = playerPos.x - resident.garden.x
    const gz = playerPos.z - resident.garden.z
    return gx * gx + gz * gz < 7 * 7
  }

  private callCops(caller: Resident): void {
    if (this.copsCalled) return
    this.copsCalled = true
    say(caller, caller.name, "That's it. I'm calling the police.")
    this.residents.forEach((resident, index) => {
      if (resident === caller || resident.concern !== 'routine') return
      resident.concern = 'approach'
      resident.approachStarted = this.elapsed
      resident.approachPoint.set(THREE.MathUtils.clamp(-4 + index * 3.2, -14, 14), 0, SIDEWALK_Z)
      say(resident, resident.name, 'What is going on over there?')
    })
    this.spawnCop(caller.mesh.parent)
  }

  // ------------------------------------------------------------ resident movement

  private maybeStartConcern(playerPos: THREE.Vector3): void {
    this.residents.forEach((resident, index) => {
      if (resident.concern !== 'routine') return
      if (resident.memory < COME_OVER) return
      if (this.elapsed < resident.cooldownUntil) return
      resident.concern = 'approach'
      resident.approachStarted = this.elapsed
      const spread = (index - 1) * 1.8
      resident.approachPoint.set(THREE.MathUtils.clamp(playerPos.x + spread, -14, 14), 0, SIDEWALK_Z)
      if (!resident.lines.some((line) => line.text === 'Is everything alright over there?')) {
        say(resident, resident.name, 'Is everything alright over there?')
      }
    })
  }

  private stepResidents(dt: number, playerPos: THREE.Vector3): void {
    for (const resident of this.residents) {
      if (resident.concern !== 'routine') {
        this.updateConcern(resident, playerPos, dt)
        continue
      }
      if (this.convo === resident) {
        // Stop and talk instead of wandering off mid-sentence.
        this.face(resident, playerPos)
        continue
      }
      if (this.elapsed >= resident.phaseEnds) {
        const next = ACTIVITIES[(ACTIVITIES.indexOf(resident.activity) + 1) % ACTIVITIES.length]
        resident.activity = next ?? 'porch'
        resident.phaseEnds = this.elapsed + 14 + Math.random() * 12
        resident.walkTarget = resident.walkTarget.equals(resident.walkA)
          ? resident.walkB.clone()
          : resident.walkA.clone()
      }
      const left = this.stepToward(resident.mesh, this.goalFor(resident), dt, 1.15)
      if (left < 0.2) this.lookAtYard(resident, dt)
    }
  }

  private updateConcern(resident: Resident, playerPos: THREE.Vector3, dt: number): void {
    if (resident.concern === 'approach') {
      const left = this.stepToward(resident.mesh, resident.approachPoint, dt, 1.7)
      const waited = this.elapsed - resident.approachStarted
      if (left < 1.25 || waited > 7) {
        resident.concern = 'asking'
        resident.askUntil = this.elapsed + 12
        this.face(resident, playerPos)
      }
    } else if (resident.concern === 'asking') {
      this.face(resident, playerPos)
      if (this.convo === resident) resident.askUntil = Math.max(resident.askUntil, this.elapsed + 4)
      if (this.elapsed >= resident.askUntil || resident.memory < 8) resident.concern = 'leaving'
    } else if (resident.concern === 'leaving') {
      const left = this.stepToward(resident.mesh, resident.home, dt, 1.3)
      if (left < 0.4) {
        resident.concern = 'routine'
        resident.cooldownUntil = this.elapsed + 40
        if (this.convo !== resident) resident.lines = []
      }
    }
  }

  // ------------------------------------------------------------ police

  private spawnCop(parent: THREE.Object3D | null): void {
    if (!parent) return
    if (!this.cruiser) {
      this.cruiser = makeCruiser()
      parent.add(this.cruiser)
    }
    if (!this.cop) {
      this.cop = makeOfficer()
      this.copBubble = new HeadBubble(this.cop, '#93c5fd')
    }
    this.cruiser.add(this.cop)
    this.cop.position.set(0.9, 0, 0.2)
    this.cop.rotation.set(0, 0, 0)
    const start = COP_PATH[0]
    if (!start) return
    this.cruiser.position.copy(start)
    this.cruiser.visible = true
    this.cop.visible = true
    this.copPoint = 1
    this.copLines = []
    this.copStrikes = 0
    this.copState = 'driving'
  }

  private updateCop(dt: number, report: PlayerReport): void {
    const cop = this.cop
    if (!cop || this.copState === 'none') return
    const playerDist = flatDistance(cop.position, report.position)

    switch (this.copState) {
      case 'driving':
        this.driveCruiser(dt)
        return
      case 'approaching':
        if (playerDist <= QUESTION_RANGE) {
          this.faceMesh(cop, report.position)
          this.copState = 'questioning'
          this.copDeadline = this.elapsed + QUESTION_TIMEOUT
          this.copSay('Officer', 'Police. Is this your house?')
          return
        }
        this.stepToward(cop, report.position, dt, COP_WALK)
        return
      case 'questioning':
        this.faceMesh(cop, report.position)
        if (playerDist > COP_HEAR_RANGE + 0.5) {
          this.startChase('Hey! I asked you a question. Stop right there.')
        } else if (this.elapsed >= this.copDeadline) {
          this.arrest("Not answering? You're coming with me.", 'You ignored the officer.')
        }
        return
      case 'waiting': {
        // Stand at the front of the property and keep an eye on you.
        const watch = this.look.set(THREE.MathUtils.clamp(report.position.x, -7, 7), 0, 10.9).clone()
        if (this.stepToward(cop, watch, dt, COP_WALK) < 0.3) this.faceMesh(cop, report.position)
        if (!onProperty(report.position)) {
          this.startChase('Where do you think you are going?')
        } else if (this.elapsed >= this.copDeadline) {
          this.arrest("Time's up. You're under arrest.", "You couldn't prove it was your house in time.")
        }
        return
      }
      case 'chasing':
        if (playerDist < 1.4) {
          this.arrest("Got you. You're under arrest.", 'You ran from the police.')
          return
        }
        this.stepToward(cop, report.position, dt, COP_RUN)
        return
      case 'arresting':
        this.faceMesh(cop, report.position)
        if (this.elapsed >= this.arrestAt) this.busted = true
        return
    }
  }

  private driveCruiser(dt: number): void {
    const cruiser = this.cruiser
    const cop = this.cop
    if (!cruiser || !cop) return
    const goal = COP_PATH[this.copPoint]
    if (!goal) return
    const pos = cruiser.position
    this.look.set(goal.x - pos.x, 0, goal.z - pos.z)
    const dist = this.look.length()
    if (dist > 0.35) {
      this.look.multiplyScalar(Math.min(1, (7 * dt) / dist))
      pos.add(this.look)
      cruiser.rotation.y = Math.atan2(this.look.x, this.look.z)
      return
    }
    if (this.copPoint < COP_PATH.length - 1) {
      this.copPoint += 1
      return
    }
    const world = new THREE.Vector3()
    cop.getWorldPosition(world)
    cruiser.parent?.add(cop)
    cop.position.copy(world)
    this.copState = 'approaching'
  }

  /** Returns true when the officer is the one you are talking to. */
  private copHears(report: PlayerReport): boolean {
    if (!this.cop || !this.copNear(report.position, COP_HEAR_RANGE)) return false
    const state = this.copState
    if (state === 'questioning') {
      if (report.explain) {
        this.copSay('You', "It's my house. I locked myself out — the key is in a fake rock.")
        this.copState = 'waiting'
        if (report.hasKey) {
          this.copDeadline = this.elapsed + PROVE_TIME_WITH_KEY
          this.copSay('Officer', `You've got the key? Then open the door. ${PROVE_TIME_WITH_KEY} seconds.`)
        } else {
          this.copDeadline = this.elapsed + PROVE_TIME
          this.copSay('Officer', `Then find it. You have ${PROVE_TIME} seconds to get that door open.`)
        }
      } else {
        this.copStrikes += 1
        this.copSay('You', this.copStrikes === 1 ? 'Evening, officer.' : 'Lovely weather, officer.')
        if (this.copStrikes >= 2) {
          this.arrest("That's enough. You're under arrest.", 'You kept dodging the officer.')
        } else {
          this.copSay('Officer', 'Answer the question. Is this your house?')
          this.copDeadline = Math.max(this.copDeadline, this.elapsed + 8)
        }
      }
      return true
    }
    if (state === 'waiting') {
      this.copSay('You', report.explain ? "I'm looking, I promise." : 'Hi again.')
      this.copSay('Officer', report.explain ? 'Clock is ticking.' : 'Less talking, more searching.')
      return true
    }
    if (state === 'chasing') {
      this.copSay('You', 'Wait — I can explain!')
      this.copSay('Officer', 'Stop moving!')
      return true
    }
    return state === 'arresting'
  }

  private startChase(line: string): void {
    this.copState = 'chasing'
    this.copSay('Officer', line)
  }

  private arrest(line: string, reason: string): void {
    if (this.copState === 'arresting') return
    this.copState = 'arresting'
    this.bustReason = reason
    this.arrestAt = this.elapsed + ARREST_DELAY
    this.copSay('Officer', line)
  }

  private copSay(who: string, text: string): void {
    this.copLines.push({ who, text })
    this.copLines = this.copLines.slice(-MAX_LINES * 2)
  }

  private copNear(playerPos: THREE.Vector3, range: number): boolean {
    if (!this.cop || this.copState === 'none' || this.copState === 'driving') return false
    return flatDistance(this.cop.position, playerPos) <= range
  }

  // ------------------------------------------------------------ bubbles over heads

  private refreshBubbles(playerPos: THREE.Vector3): void {
    for (const resident of this.residents) {
      if (resident === this.convo) {
        resident.bubble.hide() // the HUD box already shows this conversation
        continue
      }
      const visiting = resident.concern !== 'routine'
      const last = lastLineFrom(resident.lines, resident.name)
      if (visiting && last) resident.bubble.show(last)
      else if (resident.memory >= 8 && resident.name === this.alertName) resident.bubble.show('!')
      else resident.bubble.hide()
    }
    if (!this.copBubble) return
    const copInHud = this.copLines.length > 0 && this.copNear(playerPos, COP_SHOW_RANGE)
    const last = lastLineFrom(this.copLines, 'Officer')
    if (this.copState === 'none' || this.copState === 'driving' || copInHud) this.copBubble.hide()
    else if (last) this.copBubble.show(last)
    else this.copBubble.show('Police!')
  }

  // ------------------------------------------------------------ helpers

  private blocked(from: THREE.Vector3, to: THREE.Vector3): boolean {
    return segmentHitsOccluder(from.x, 1.5, from.z, to.x, 1.2, to.z, this.occluders)
  }

  private canSee(mesh: THREE.Object3D, playerPos: THREE.Vector3, range = VIEW_RANGE, cone = CONE): boolean {
    const pos = mesh.position
    const dx = playerPos.x - pos.x
    const dz = playerPos.z - pos.z
    const dist = Math.hypot(dx, dz)
    if (dist > range || dist < 0.45) return false
    const yaw = mesh.rotation.y
    const facing = (Math.sin(yaw) * dx + Math.cos(yaw) * dz) / dist
    const onSidewalk = pos.z > 11 && pos.z < 14.8
    const yardBeside = onSidewalk && playerPos.z < pos.z - 0.4 && dist < 12
    if (facing < cone && !yardBeside) return false
    return !this.blocked(pos, playerPos)
  }

  private stepToward(mesh: THREE.Object3D, goal: THREE.Vector3, dt: number, speed: number): number {
    const pos = mesh.position
    const dx = goal.x - pos.x
    const dz = goal.z - pos.z
    const dist = Math.hypot(dx, dz)
    if (dist > 0.08) {
      const step = Math.min(1, (speed * dt) / dist)
      pos.x += dx * step
      pos.z += dz * step
      mesh.rotation.y = Math.atan2(dx, dz)
    }
    pos.y = 0
    return dist
  }

  private lookAtYard(resident: Resident, dt: number): void {
    const pos = resident.mesh.position
    const desired = Math.atan2(0 - pos.x, 4 - pos.z)
    resident.mesh.rotation.y = dampAngle(resident.mesh.rotation.y, desired, dt, 0.7)
  }

  private face(resident: Resident, playerPos: THREE.Vector3): void {
    this.faceMesh(resident.mesh, playerPos)
  }

  private faceMesh(mesh: THREE.Object3D, playerPos: THREE.Vector3): void {
    const pos = mesh.position
    mesh.rotation.y = Math.atan2(playerPos.x - pos.x, playerPos.z - pos.z)
  }

  private goalFor(resident: Resident): THREE.Vector3 {
    if (resident.activity === 'porch') return resident.home
    if (resident.activity === 'mail') return resident.mail
    if (resident.activity === 'garden') return resident.garden
    return resident.walkTarget
  }
}

function say(resident: Resident, who: string, text: string): void {
  resident.lines.push({ who, text })
  resident.lines = resident.lines.slice(-MAX_LINES * 2)
}

function lastLineFrom(lines: DialogueLine[], who: string): string | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (line && line.who === who) return line.text
  }
  return null
}

function flatDistance(a: THREE.Vector3, b: THREE.Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

/** The player's own lot: fenced sides, house at the back, sidewalk at the front. */
function onProperty(pos: THREE.Vector3): boolean {
  return Math.abs(pos.x) < 9.5 && pos.z > -11 && pos.z < 13.5
}

function dampAngle(current: number, desired: number, dt: number, speed: number): number {
  let delta = desired - current
  while (delta > Math.PI) delta -= Math.PI * 2
  while (delta < -Math.PI) delta += Math.PI * 2
  return current + delta * Math.min(1, dt * speed)
}
