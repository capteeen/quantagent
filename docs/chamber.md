# The chamber: what each visual means

The chamber is the 3D view a person sees while their coin is being made. It is not a loading screen and not a progress bar: it is a machine made of light, visibly computing. Everything in it is driven by a real event from the bus; nothing moves on a timer except the ambience listed last. Copy that describes the chamber should use these meanings and no others.

## The vessel

Eight nested glass cylinders hang from a glass plate, each with eight glass pylons: the chandelier of a dilution refrigerator rendered as pure light and glass in a void. The tiers are the stages the computation passes through, outer to inner. The vessel itself never changes with the launch; it is the instrument. Its edges glow cyan from a rim light behind it. Depth comes from fog and depth of field, never from scenery.

## The core

The sphere in the innermost tier is the coin. Before launch it is empty glass with a faint pink pulse: a coin that does not exist yet and whose identity is genuinely undetermined. After `Launch.live` it expands and becomes a glass frame around the coin's real logo, lit from within, with the contract address and the site URL typed beneath it. Those two lines are the only text the chamber ever shows about the coin, and they are always the deployed values, never a placeholder. On the coin page the core's glass clouds as the coin decays (`Chain.decay`); a quantum measurement of its state replays the collapse on the core.

## The eight strands

Each worker is a strand: a tube of light in its colour (Ideator cyan, Artist magenta, Builder orange, Launcher white, Voice amber, Trader green, Shield red, Recruiter violet) spiralling from the core out through the tiers to an anchor on the outermost cylinder. At `Launch.started` all eight ignite within 100ms. Simultaneous ignition is the thesis: eight processes start at once. A strand that ignites late means the orchestrator started that worker late, and the chamber will show it.

## Pulses

A bright packet travelling down a strand from the core to its anchor is one `Worker.progress` event: one logged step with a reason. There is exactly one pulse per progress event, so a busy strand is busy and a quiet strand is quiet. The anchor brightens with every packet that arrives: cumulative progress. Pulses are never decorative.

## Strand states

- **Running**: pulses flow, the anchor brightens.
- **Awaiting approval**: the pulses stop and the strand breathes amber with a small glass ring at its anchor. Money or reputation is about to move and a human tap is required. Nothing happens until it is given.
- **Candidates (the fan)**: the strand splits into several ghost tubes, each ending in a glass bead with a name or a thumbnail. This is superposition: the worker has produced several possible outcomes and none of them is chosen yet.
- **Done**: the strand locks solid and the anchor seals with a glass cap and a soft ring flash. The worker's outputs are final.
- **Failed**: the strand desaturates to grey over 1.2 seconds, one red pulse runs backwards from the anchor to the core, and the anchor cracks. The crack stays for the life of the launch. A failure is shown as a failure.

Tapping a strand or its anchor opens that worker's sheet; the tapped strand brightens and the others dim.

## The collapse

The collapse is the signature moment and the only animation that snaps. It plays only on `Orchestrator.collapsed`, which carries a verifiable quantum random draw with its proof:

1. The chamber dims and a white beam leaves the core upward and out of frame: the entropy request leaving for the quantum random number generator.
2. A shower of white photons falls into the vessel and converges on the fan: the entropy arriving.
3. The ghost tubes flicker and the beads jitter: the measurement.
4. The collapse: every non-chosen branch vanishes in one frame, the chosen one snaps to full brightness, a ring expands from its bead, the core flashes, and a C6 tone plays if sound is on.
5. The proof hash types in beside the chosen bead. Tapping it opens the proof bundle (provider, entropy, attestation, draw hash).
6. The chamber returns to full brightness.

If the quantum source is unreachable, there is no collapse: the fan stays open with "QRNG unreachable, pick one" and the user chooses. A user pick snaps without the beam and the shower, because no entropy was requested. No pseudorandom draw is ever dressed as a collapse.

## The Launcher handoff

When the Launcher reaches the QSD protocol the camera moves in onto the innermost tier and the launch's cryptography renders around the core, stage by stage, on real events:

- **Key generation**: 67 hash chains grow link by link, each link a small glass cube, 16 deep, in a cylinder around the core. 1072 links, never fewer.
- **Merkle tree**: the chain tips fold into 256 leaves that rise and fuse in pairs, level by level, into one white root: the coin's identity root.
- **Superposition**: a shimmering band and a rotating half-life ring around the core: the coin's state parameters, including how long it keeps its identity before it decays.
- **Quantum draw**: the collapse, applied to the core.
- **Signing**: light runs down each chain to its signing depth; those 67 cubes lift out and lock into a ring, and the authentication path to the root lights node by node: the signature.
- **Anchoring**: the signed state compacts to one bright packet that travels a lane of light to a block, which seals when the transaction confirms; the transaction signature types in beside it. The camera pulls back and the Launcher strand seals.

The other seven strands stay visible throughout: the rest of the agent keeps working during the launch.

## The convergence

On `Launch.live` every sealed strand sends one final bright pulse back to the core at once. They meet, the core flashes and expands into the logo frame, and the contract address and site URL type in beneath it. The strands relax to an idle shimmer. 1.8 seconds in, the CoinCard slides up over the lower part of the screen (the app's job, signalled by `onLive`).

## The coin page

The chamber stays alive after launch. A long-lived worker's strand pulses on its post-launch progress, so an active agent visibly hums and a paused one visibly rests. Decay is the core's glass clouding. A measurement is a collapse on the core.

## Ambience (the only time-driven motion)

The camera orbits at 0.3° per second and breathes 2% in and out; cryogenic vapour drifts up through the vessel; the core pulses gently when idle. These say "the machine is on"; they never say "something happened". Under reduced motion the orbit stops and the photon shower, the flicker and the chromatic aberration become short fades; every state stays readable.

## Sound (off by default)

A 55Hz hum with an octave harmonic that rises with total worker activity, and a pure C6 on every collapse. Entirely procedural; no audio files.
