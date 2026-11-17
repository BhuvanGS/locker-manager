import type * as THREE from 'three'

export type DialogueLine = { who: string; text: string }
export type DialogueOption = { key: 'G' | 'X'; label: string }
export type DialogueView = {
  speaker: string
  tone: 'neighbour' | 'police'
  lines: DialogueLine[]
  options: DialogueOption[]
}

/**
 * Police flow once a neighbour calls it in:
 * driving → approaching → questioning → waiting (prove it's your house) → arresting.
 * Walking away while questioned, or leaving the property while waiting, starts a chase.
 */
export type CopState =
  | 'none'
  | 'driving'
  | 'approaching'
  | 'questioning'
  | 'waiting'
  | 'chasing'
  | 'arresting'

export type Occluder = {
  center: THREE.Vector3
  half: THREE.Vector3
}

export type PlayerReport = {
  position: THREE.Vector3
  crouching: boolean
  holdingRock: boolean
  onGravel: boolean
  speed: number
  pickedRock: boolean
  greet: boolean
  explain: boolean
  hasKey: boolean
}

export type NeighbourObservation = {
  /** The conversation the HUD should show, or null. Same object while unchanged. */
  dialogue: DialogueView | null
  suspicion: number
  alertName: string | null
  copsCalled: boolean
  copState: CopState
  /** Seconds left to open the door while the officer waits. */
  copTimer: number | null
  busted: boolean
  bustReason: string | null
  talkPrompt: string | null
}
