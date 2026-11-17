---
name: npc-dialogue
description: Change how neighbours and the police behave and talk in Which One's My Key? — dialogue lines, G/X options, suspicion rules, talk ranges, the police state machine, arrest reasons, and how dialogue shows in the HUD and head bubbles.
---

# NPCs, dialogue and police

The code is in `src/npcs/`:

| File | What's in it |
| --- | --- |
| `NeighbourDirector.ts` | All behaviour: resident routines, suspicion memory, conversations, police state machine, what the HUD sees |
| `types.ts` | `DialogueLine`, `DialogueOption`, `DialogueView`, `CopState`, `PlayerReport`, `NeighbourObservation`, `Occluder` |
| `HeadBubble.ts` | Single-line speech bubble sprite (depth-tested, so walls hide it) |
| `models.ts` | Resident, officer and cruiser meshes |
| `occlusion.ts` | `segmentHitsOccluder`, used for "can they see / hear me" |

Data flow: `Engine` builds a `PlayerReport` each frame, then `world.updateNeighbours()` →
`NeighbourDirector.update()` returns a `NeighbourObservation`. `Engine` writes `dialogue`, `copState`, `copTimer`,
suspicion and the arrest reason into the store, and `ui/GameHUD.tsx` renders them.

## Conversation rules

- **Who hears you:** `talkTarget()` picks the nearest resident within `TALK_RANGE` (4.5 m), or `ASK_RANGE` (7 m) if they
  came over to ask, with no occluder in between.
- **Active conversation:** `this.convo`. It's set when you press G/X at someone, or when a resident who walked over to ask
  is within `ASK_RANGE`. It closes past `CONVO_DROP` (8.5 m). Lines are cleared when the resident goes back to their routine.
- **Lines:** add them with `say(resident, who, text)`. The HUD shows the last `MAX_LINES` (4).
- **Options:** `currentView()` builds the G/X labels. Labels describe what the player will say, so update them when
  you change the lines in `handleSpeech()`.
- **Head bubbles:** `refreshBubbles()` shows only the latest line of people who are not in the HUD box.
- **Re-renders:** `observe()` caches the view by JSON signature. Keep `DialogueView` plain, serialisable data.

## Suspicion

`remember()` adds memory per resident when they `canSee()` you: walking on the gravel +1, picking up a rock +5,
crawling +10, being near their property +15. Memory only decays (slowly) while you're well away from the street
(`leftArea` in `remember()`).
`COME_OVER` (20) sends them over to ask. `CALL_COPS` (45) calls the police.
Talking: the first greeting is −5 and the first explanation −15. Repeats add +20/+35 (greet) or +30/+45 (explain).
Once the police are called, residents stop escalating and answer "Tell it to the police."

## Police state machine (`CopState`)

```
none → driving → approaching → questioning ──X──▶ waiting ──door opened──▶ (Engine: won)
                                    │  G×2 / timeout        │ timer ends
                                    ▼                       ▼
                                 arresting ◀── chasing ◀── leave lot / walk away
```

- `copHears()` handles G/X near the officer (`COP_HEAR_RANGE` 6 m) before residents get them.
- Use `arrest(line, reason)` for every arrest. `reason` appears on the results screen. `busted` turns true after
  `ARREST_DELAY` so the line can be read.
- Timers: `QUESTION_TIMEOUT` 15 s, `PROVE_TIME` 60 s, `PROVE_TIME_WITH_KEY` 25 s. The HUD chip shows `copTimer` while waiting.
- Speeds: officer walks at 2.8 and runs at 6.6, faster than the player's sprint (6.2), so running away fails on purpose.
- To add a state, add it to `CopState` in `types.ts`, then handle it in `updateCop()`, `copHears()`, `copOptions()` and
  `policeStatus()` in `GameHUD.tsx` (the switch has to cover every state).

## Adding a neighbour

Add a spec in the constructor: name, colour, and `home` / `mail` / `garden` / `walkA` / `walkB` points on open ground
(see the `world-building` skill for what's occupied). `home` should be just in front of their house's porch. Every
resident automatically gets a bubble, suspicion, conversations and police reactions.

## Verify

1. `npm run typecheck && npm run lint`
2. Run the `playtest` skill's "Neighbour conversation" and "Police flow" recipes. Screenshot the dialogue box and
   confirm the results-screen reason text.
