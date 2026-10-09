# @quantagent/ui

Design tokens, the phone-first kit, and **THE CHAMBER**: the 3D view of eight workers computing at once (SPEC §6).

```
pnpm --filter @quantagent/ui test        # vitest (jsdom, minimal WebGL stub)
pnpm --filter @quantagent/ui typecheck
pnpm --filter @quantagent/ui storybook   # every strand state + the full collapse from the recorded fixture
pnpm --filter @quantagent/ui frametime   # Playwright 390×844, CPU 4×, fixture at real timings, median ≥ 55fps
pnpm --filter @quantagent/ui shot -- launch 25 out.png   # screenshot the chamber at a fixture seq
pnpm --filter @quantagent/ui fixture     # regenerate src/fixtures/launch.recorded.json
```

## Exports

| path | what |
| --- | --- |
| `@quantagent/ui` | everything below |
| `@quantagent/ui/chamber` | `<Chamber />`, `createChamberStore`, timelines, layout, sound, perf |
| `@quantagent/ui/kit` | ConnectCard, PromptBox, LaunchButton, ThreadStrip, WorkerSheet, ApprovalCard, CoinCard, ShieldReport, LogRow, EmptyState, AutopilotToggle |
| `@quantagent/ui/tokens` | colours, fonts, motion, `tokensCss` |
| `@quantagent/ui/tailwind-preset` | the Tailwind preset |
| `@quantagent/ui/fonts.css` | JetBrains Mono + Space Grotesk |
| `@quantagent/ui/fixtures/launch.recorded.json` | a recorded full launch (tests + Storybook only) |

## The chamber

```tsx
import { Chamber, createChamberStore } from "@quantagent/ui/chamber";

const store = createChamberStore();
bus.subscribe((event) => store.apply(event)); // the ONLY way anything moves

<Chamber
  mode="launch"                 // "idle" | "launch" | "live" | "coin"
  store={store}
  onTapWorker={(w) => openWorkerSheet(w)}
  onTapProof={(w, proof) => openProofBundle(w, proof)}
  onLive={() => slideUpCoinCard()}   // Launch.live + 1800ms
  sound={false}                 // procedural Web Audio, off by default
  framing="spec"                // see "Framing"
/>
```

### Store

`createChamberStore()` returns a zustand vanilla store (`getState / subscribe`) with its actions bound on the object:

- `apply(event)` / `applyMany(events, { silent? })`: fold `QuantagentEvent`s. `silent` rebuilds state from a log without replaying effects (the coin page).
- `reset()`, `takeEffects()`, `select(worker)`, `setSettings({ reducedMotion, perfTier })`.
- `useChamber(store, selector)` for React.
- `foldEvent(state, event, nextEffectId)` is the pure reducer; `serializeChamberState(state)` is the JSON projection used by snapshots.

State: `phase`, eight `strands[worker]` (`status`, `progressCount`, `pulses` (== progress count), `candidates`, `chosen`, `proof`, `approval`, `failed`, `sealed`, `collapseUnavailable`), `qsd` (67×16 `links`, `treeLevelsFused`, `signStops`, `anchorTx`, `skipped`), `core` (`ca`, `siteUrl`, `logoUrl`, `roughness`, `live`), and a transient `effects` queue (ignition, collapse, coreCollapse, convergence, ringFlash, failPulse, dollyIn, dollyOut) that the scene drains.

Rule (SPEC §6.7): no visual without an event. Idle ambience (orbit 0.3°/s, 2% dolly breathing, vapour drift, the core pulse) is the only time-driven motion; every other animation is a fixed-duration transition started by an event. The Launcher's `Worker.progress` step `"qsd-skipped"` means there is no QSD handoff: the Launcher strand just runs.

### Events → visuals

| event | visual |
| --- | --- |
| `Launch.started` | all eight strands ignite within 100ms (900ms core→anchor, head + 30 sparks) |
| `Worker.progress` | one pulse core→anchor at 1.5 u/s; the anchor brightens cumulatively |
| `Worker.awaitingApproval` | pulses stop, amber breathe (0.8s), glass ring at the anchor |
| `Worker.candidates` | the strand fans into N ghost tubes with beads and labels / 48px thumbnails (600ms) |
| `Orchestrator.collapsed` | §6.4 exactly: dim 40%, beam, 120 photons, 24Hz flicker, snap at 1200ms, ring, 2-frame core flash, aberration 0.004, C6, proof hash typed in, restore |
| `Orchestrator.collapseUnavailable` | the fan stays open with "QRNG unreachable, pick one" |
| `Orchestrator.userPicked` | the collapse without the beam and shower |
| `Worker.done` | strand locks solid, anchor seals with a glass cap, soft ring flash |
| `Worker.failed` | desaturates to #3A4049 over 1.2s, one red pulse anchor→core, the anchor cracks and stays cracked |
| `Launcher.qsdStage keyGeneration` | camera dollies 7.5→4.2 over 1.2s; `chainStep` grows 67×16 glass cubes |
| `Launcher.treeLevelFused` | 256 leaves fuse level by level to a white root |
| `Launcher.qsdStage superposition / quantumDraw` | band + half-life ring; §6.4 applied on the core |
| `Launcher.signChainStop` | light runs down the chain to its stop; the 67 cubes lift into a ring; the auth path lights |
| `Launcher.qsdStage anchoring` / `Launcher.deployed` | packet → block seals, tx typed in; camera back to 7.5 |
| `Launch.live` | §6.6: final pulses meet at 900ms, core 0.35→0.55, logo frame, CA + URL typed in, `onLive` at 1800ms |
| `Artist.logoReady` | the only texture: the coin's real logo, shown after Launch.live |
| `Chain.decay` | the core's glass clouds (roughness 0.05→0.6) |
| `Chain.measurement` | §6.4 replayed on the core |

### Framing

`framing="spec"` (default) uses SPEC §6.2 verbatim: camera (0, 1.2, 7.5) looking at (0, 0.4, 0), fov 38. On a 390×844 portrait frame that shows 2.4 world units across at the core, so the outermost tier (radius 3.0) and six of the eight anchors sit outside the frame; the strands leave the frame toward them. `framing="fit"` keeps the fov and target and pulls back on portrait viewports until the whole anchor ring is in frame. Storybook uses `fit`.

### Launch sequence adapter

`LaunchSequenceAdapter` is the contract for hosting qsd-market's `<LaunchSequence />` inside the chamber's render loop (same renderer, same post-processing). qsd-market is not linked in this repo, so the default `eventDrivenLaunchSequence` renders the six stages from `Launcher.*` events. Wrap the real component in an adapter and pass `launchSequence={...}`; never fork it.

### Performance

One `WebGLRenderer` (one Canvas), instanced geometry for every repeat (pylons, sparks, pulses, beads, photons, 1072 chain links, 256 leaves, 67 signing cubes), `useDisposable` for every geometry/material, lazy strands and post-FX behind the first frame. A rolling frame-time monitor drives the ladder particles → bloom radius → DOF → iridescence → aberration; strands, pulses, the collapse and the chain link count are never degraded. Reduced motion stops the orbit and replaces shower, flicker and aberration with 200ms fades.

`frametime` prints the median frame time under 4× CPU throttling and the heap before/after. On software GL (SwiftShader, the only GPU available in CI containers) the fps assertion is reported but not enforced unless `FRAMETIME_STRICT=1`.

### Sound

`ChamberSound`: a 55Hz sine hum with a 110Hz octave that rises with worker activity, and a C6 (1046.5Hz, 300ms, soft attack) on every collapse. No audio files. Off by default; `sound` enables it from the chamber's first tap.

## Environment

This package reads no environment variables. The frametime/shot scripts read `PLAYWRIGHT_BROWSERS_PATH`, `CHROMIUM_PATH`, `FRAMETIME_SPEED`, `FRAMETIME_STRICT`, `FRAMETIME_DPR`, `FRAMETIME_SCREENSHOT` (tooling only).

See `/docs/chamber.md` for what each visual means, so copy never describes it wrong.
