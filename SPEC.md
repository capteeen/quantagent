# QUANTAGENT · quantagent.fun
# BUILD INSTRUCTIONS FOR CLAUDE CODE

You are the lead engineer on quantagent. Read this whole file, write it to
SPEC.md at the repo root, and re-read SPEC.md at the start of every session.

Run this build as a TEAM OF SUBAGENTS in parallel. Spawn them with the Agent
tool, give each its section verbatim, and act as integrator and reviewer.
Never build everything yourself serially: the product is about parallel
work, and so is the build.

═══════════════════════════════════════════════════════════════════════════
0. WHAT WE ARE BUILDING
═══════════════════════════════════════════════════════════════════════════

Connect your project's X account. Connect your wallet. Type one line. Tap.

Eight workers start simultaneously: Ideator, Artist, Builder, Launcher,
Voice, Trader, Shield, Recruiter. By the time the pump.fun transaction
confirms, the coin has a name, a full image set, a live website showing the
correct contract address, an announcement thread with the CA posted from the
project's own X account, a wallet that has already bought in, a shield
already scanning for copycats, and people already replied to. The agent then
keeps running: posting, trading, defending, recruiting, updating the site,
every action logged with a reason.

Quantum is not decoration. Parallel branches collapsing to one result is the
real idea of quantum computation. When workers produce multiple candidates
(five names, twelve images), a verifiable quantum random draw collapses the
choice, with proof. The coin's identity is genuinely undetermined until it
launches.

Launches run through the QSD protocol (qsd-market repo): hash-based
identity, superposition, quantum draw, signing, anchoring. When a coin goes
quiet it decays into a daughter with the same agent attached.

The chamber, the 3D view of all eight workers computing at once, is the
product's face. It gets the most effort of anything on the team.

LIVE ONLY. No mock coins, no fake posts, no simulated workers, no seeded
data. Every image is really generated, every post really posted, every site
really deployed, every trade really executed (devnet first). Empty states
render empty and honest.

═══════════════════════════════════════════════════════════════════════════
1. TEAM — spawn these agents
═══════════════════════════════════════════════════════════════════════════

Spawn A, B, C, D in parallel immediately. They share nothing but types.

AGENT A — "core"       /packages/core: orchestrator, worker runtime, event
                       bus, job state. Section 3.
AGENT B — "workers"    /packages/workers: the eight workers. Section 4.
                       Spawn EIGHT sub-agents, one per worker.
AGENT C — "chamber"    /packages/ui: tokens, phone-first kit, and THE
                       CHAMBER. Section 6. Spawn three sub-agents.
AGENT D — "x"          /packages/x: X client on the user's connected
                       account. Section 5.
AGENT E — "chain"      /packages/solana: QSD integration, pump.fun,
                       wallets, trades, holder data. Section 7. After A.
AGENT F — "app"        /apps/web: onboarding, the one screen, follow-up
                       screens. Section 8. After A, C.
AGENT G — "verify"     /tests, /docs: adversarial reviewer, never saw the
                       code written. Section 9. Starts when A and B
                       finish, runs continuously after.

RULES FOR ALL AGENTS
- Write only inside your owned directory plus your tests.
- Expose a typed public API from your package index, documented in a
  package README.
- Never stub, fake or hardcode a value the spec says must be produced. If
  it can't be done yet, throw NotImplemented with the reason and report.
- "Done" means tests pass, not that files exist.
- The integrator reviews every delivery against this spec and rejects
  anything that fakes a worker, hides a failure, posts without a log, or
  animates without an event.

Monorepo: pnpm workspaces + Turborepo, TypeScript strict. /apps/web,
/packages/{core,workers,ui,x,solana}. Shared types in /packages/core/types.

═══════════════════════════════════════════════════════════════════════════
2. NON-NEGOTIABLE QUALITY BARS
═══════════════════════════════════════════════════════════════════════════

- TRUE PARALLELISM. All eight workers start within 100ms of each other and
  run concurrently. Agent G measures this. A sequential pipeline dressed as
  parallel is a failed build.
- EVERYTHING LOGGED. Every worker action emits an event: what, why, inputs,
  outputs, external ids (tx signature, post id, image url, deploy id). The
  user can tap any strand and read the full reason chain.
- HUMAN GATE WHERE MONEY OR REPUTATION MOVES. First launch: the Voice's
  posts, the Recruiter's outreach, and the Trader's buys beyond the dev buy
  require a tap to approve. Autopilot is an explicit per-coin, per-action
  opt-in. Agent G verifies nothing posts, reaches out, or trades without
  approval or an enabled autopilot flag.
- THE CA IS NEVER WRONG. No post, page, or report ever shows a contract
  address other than the deployed one. "Pending launch" until deployed,
  then the real CA within 5 seconds everywhere.
- QUANTUM RANDOMNESS IS REAL. Candidate selection uses @qsd/quantum with
  attestation. No pseudorandom fallback in production (test that it's
  impossible). If the QRNG is unreachable, candidates are shown and the
  user picks; the UI says why.
- PHONE FIRST. Every screen designed at 390px first. Under 3 seconds to
  the launch screen on mobile data.
- NOTHING INVENTED. A missing image, a failed post, a failed deploy, a
  rejected trade is shown as exactly that. No placeholder content, ever.

═══════════════════════════════════════════════════════════════════════════
3. AGENT A — CORE  (/packages/core)
═══════════════════════════════════════════════════════════════════════════

ORCHESTRATOR
- launch(prompt, connections, options) creates a Launch job and starts all
  eight workers concurrently via Promise.allSettled over isolated worker
  contexts. Workers communicate ONLY through the event bus.
- Dependencies are event subscriptions, not call order. Every worker
  starts immediately and does whatever it can before its inputs arrive:
  the Artist generates from the prompt alone; the Builder scaffolds the
  site from the prompt alone; the Shield scans the prompt's keywords for
  pre-existing copycats.
- Collapse step: when a worker yields multiple candidates, the
  orchestrator requests one quantum draw from @qsd/quantum, records the
  proof bundle, selects, and emits Orchestrator.collapsed with the proof.

THE CA HANDSHAKE
Launcher.deployed(coinCa) is the most important event in the system. On it,
three workers react independently and simultaneously:
  Builder → patch CA block + buy link, republish site
  Voice   → post the CA with the site link (pre-drafted ApprovalCard
            waiting, so approval is one tap; instant if autopilot.posts)
  Shield  → register coinCa as canonical for all copycat comparison
Agent G asserts all three react within 5 seconds on a real devnet launch.

EVENT BUS
- Typed events: Launch.started, <Worker>.started, <Worker>.progress,
  <Worker>.candidates, Orchestrator.collapsed(worker, chosen, proof),
  <Worker>.awaitingApproval, <Worker>.done, <Worker>.failed(reason),
  Launcher.deployed(coinCa), Builder.published(url), Launch.live,
  Launch.failed, and post-launch events per worker.
- Persistent (Postgres) and streamed (Redis pub/sub → SSE). Replayable: a
  Launch's event log reconstructs UI and chamber state exactly.

WORKER RUNTIME
- Interface: start(ctx), on(event), stop(). ctx carries the prompt, launch
  id, scoped LLM / image / X / Solana / hosting clients, and emit().
- Per-worker budgets (tokens, API calls, SOL, deploys) enforced in ctx;
  exceeding a budget fails the worker, never the launch.
- ctx.requireApproval(action) blocks until the user taps approve or
  autopilot is on for that action class.

STATE
- Launch { id, prompt, ownerWallet, xAccountId, status, startedAt, liveAt?,
  coinCa?, siteUrl?, agentWallet, autopilot: { posts, trades, recruiting },
  workers: Record<WorkerName, WorkerState> }
- WorkerState { status, startedAt, doneAt?, candidates?, chosen?, proof?,
  outputs: Record<string, unknown>, failReason? }

POST-LAUNCH RUNTIME
- After Launch.live, Voice, Trader, Shield, Recruiter, Builder and Artist
  run as long-lived BullMQ workers on the same bus, budgets and gates.
  Ideator runs on demand from the Voice.

TESTS: eight starts within 100ms; isolation (a crashed worker cannot crash
another); replay fidelity; gate enforcement; budget enforcement; CA
handshake timing.

═══════════════════════════════════════════════════════════════════════════
4. AGENT B — WORKERS  (/packages/workers)  — eight sub-agents
═══════════════════════════════════════════════════════════════════════════

Each worker is its own folder with its own tests, emits the full event
vocabulary, and writes a one-line human reason for every output.

B1 IDEATOR
- Input: prompt (possibly empty). Pulls live X trends via Agent D.
- Output: 5 candidate identities { name, ticker, lore, hook, trend }.
  Emits Ideator.candidates; the orchestrator collapses.
- Constraints: ticker ≤ 6 chars, name not live on pump.fun (Agent E), no
  real person's name, no protected brand.
- Post-launch: on Voice.needsAngle, 3 new angles from mentions and chart.

B2 ARTIST
- Starts from the prompt alone; re-renders with the final name once
  chosen. Output: logo (square), banner (X header), 6–12 character images
  in one consistent style. Emits Artist.candidates for the logo; the
  orchestrator collapses the choice with a quantum draw.
- Pluggable image provider (research current options; integrator supplies
  keys). Object storage; emit urls. Content rules in code: no real people,
  no protected characters or brands, nothing sexual or violent. A failed
  generation is logged, never replaced with a stock image.
- Post-launch: on Voice.needsImage(brief) or Builder.needsAsset, generate.

B3 BUILDER
- Starts at t=0 from the prompt: scaffolds a single-page site in the QSD
  aesthetic (void, glass, mono) from a pre-built static template with
  placeholder blocks that fill as events arrive: Ideator.named →
  title/ticker/lore; Artist.logoReady → favicon/hero; Artist.imageReady →
  gallery; Launcher.deployed → CA block, pump.fun buy button, chart embed;
  Voice.posted → embed of the announcement thread.
- Publishes to <ticker>.quantagent.site within 15 seconds of t=0, BEFORE
  the coin exists, so the Voice's first post can link to it. CA block shows
  "CA: pending launch" with a live indicator until deployed.
- On Launcher.deployed: patch + republish within 5 seconds. Agent G times
  it. Hosting via an edge adapter with no build step (content injected at
  publish, pushed to Cloudflare Pages / Vercel API / own edge — research).
  Custom-domain connect for users who have one. HTTPS. OG image from logo
  + ticker so the link unfurls on X.
- Post-launch: site updates on Voice.posted (feed), Artist.imageReady
  (gallery), chart milestones (live stat strip), Shield.copycatFound
  ("verify the real CA" banner). Every patch logged with its trigger.

B4 LAUNCHER
- Input: chosen identity + logo. Runs the QSD launch end to end via Agent
  E: identity key, superposition params, quantum draw, signing, anchoring,
  pump.fun deploy with dev buy. Emits every QSD stage event so the chamber
  renders the cryptographic sequence. Emits Launcher.deployed(coinCa).
- Output: coinCa, tx signatures, identity root, proof bundle.

B5 VOICE
- Posts ONLY from the X account the user connected (Agent D). Sets avatar
  and banner from the Artist.
- At launch: announcement thread (hook, lore, site link, first two
  images), then the CA post on Launcher.deployed. Gated unless
  autopilot.posts; approval cards are pre-drafted so approval is one tap.
- Post-launch: replies to mentions, reacts to chart milestones, posts new
  images, asks the Ideator for angles when engagement drops. Platform
  rate limits honoured. Every post logged with reason and post id. Never
  posts the same text twice.

B6 TRADER
- Controls the agent wallet (Agent E). At launch: the dev buy only.
- Post-launch rules (deterministic, /docs/trading.md): support buys on
  defined dips within budget, no selling in the first 24h, one-line reason
  per trade, every tx signature logged. Gated unless autopilot.trades.
  Never trades another coin. Never exceeds the SOL budget.

B7 SHIELD
- From t=0: scans pump.fun and X for coins using the chosen name, ticker,
  or a perceptual-hash match of the logo (Agent E + D).
- On Launcher.deployed: registers the real CA as canonical.
- On a match: files it on the coin page with evidence; has the Voice flag
  it publicly (gated like a post); has the Builder raise the site banner.
  Detects bundled launches of the coin's own CA and dev-wallet anomalies.
- Output: live Shield report { canonicalCa, copycats[], bundleFlags[] }.

B8 RECRUITER
- Finds accounts actively posting about the narrative via Agent D's
  search; ranks by relevance and reach; drafts replies and invitations.
  Gated unless autopilot.recruiting. Hard caps per hour. Never DMs. Never
  bulk follows. Logs every outreach.

═══════════════════════════════════════════════════════════════════════════
5. AGENT D — X  (/packages/x)
═══════════════════════════════════════════════════════════════════════════

- OAuth 2.0 PKCE on the PROJECT'S OWN account: tweet.read, tweet.write,
  users.read, offline.access, media upload. Tokens encrypted at rest.
- NO account provisioning anywhere in the codebase. The Voice posts only
  from accounts the user connected. Document this.
- Posting, threads, media upload, replies, mentions polling, search
  (trends and narrative discovery), profile update (avatar, banner).
- Token-bucket rate limiter per account and globally; honour reset
  headers; backoff on 429; dead-letter queue with visible retry.
- Monthly call budget with a /status readout. At 100%, posting pauses and
  the UI says so.

═══════════════════════════════════════════════════════════════════════════
6. AGENT C — THE CHAMBER  (/packages/ui)  ← highest effort on the team
═══════════════════════════════════════════════════════════════════════════

You own what a person on a phone SEES while their coin is being made. It
must feel like standing inside a quantum computer: a machine made of light,
visibly computing, eight processes running at once and collapsing into one
result. Not a loading screen. Not a progress bar.

Sub-agents: C1 "materials+scene" (vessel, lighting, glass, post-processing),
C2 "strands+collapse" (the eight strands and the collapse events),
C3 "performance" (instancing, LOD, mobile profiling, degradation).

6.1 THE AESTHETIC — write this down before any code
A real quantum computer is a dilution refrigerator: a gold-and-copper
chandelier of nested cylinders in a cryostat near absolute zero. We render
that as pure light and glass in a void. Nothing opaque, nothing textured.
- VOID. #06080A with a faint cold radial gradient to #0B1220 at the edges.
  No skybox, no grid. Depth from fog (near 8, far 40, #06080A) and
  depth-of-field, not scenery.
- GLASS. MeshPhysicalMaterial: transmission 1.0, thickness 0.4–1.2, ior
  1.45, roughness 0.05–0.15, iridescence 0.6, iridescenceIOR 1.3. Rim key
  light in #4DD0E1 behind the vessel so edges glow against the void.
- LIGHT IS COMPUTATION. Idle = dim glass. Active = emissive #FFE6F2 at
  intensity 2–4, caught by UnrealBloom (strength 0.9, radius 0.6,
  threshold 0.75). Whatever is computing is the brightest thing on screen.
- COLD. 200 instanced additive points, size 0.02, drifting 0.05 units/s:
  cryogenic vapour. Always on, always subtle.
- MOTION. Nothing snaps except a collapse. cubic-bezier(0.4,0,0.2,1),
  700ms+. Light travels at a visible pace, like a pulse down a fibre. The
  camera drifts constantly (0.3°/s orbit, 2% dolly breathing).
- SOUND (off by default). Procedural Web Audio: a 55Hz cryogenic hum with
  a soft octave harmonic rising with total worker activity; a pure C6 tone
  (300ms, soft attack) on every collapse. No audio files.

6.2 THE VESSEL
Eight nested glass cylinders (radius 3.0 → 0.6, 0.08 thick) hanging from a
glass plate, eight glass pylons per tier (the chandelier). The innermost
holds THE CORE: a sphere, radius 0.35, representing the coin.
Idle: dim glass, cyan edges, core pulsing (emissive 0.3↔0.6 over 2.4s),
vapour drifting, camera orbiting. Beautiful enough to screenshot alone.
Portrait: vessel fills the top 55% of 390×844, camera (0, 1.2, 7.5) looking
at (0, 0.4, 0), fov 38. Wider viewports widen the frame, never the
composition.

6.3 THE EIGHT STRANDS
Each worker is a STRAND: a tube of light (TubeGeometry on a CatmullRom
curve, radius 0.025, 64 segments, emissive in its colour) spiralling from
the core outward through the tiers to its anchor on the outermost
cylinder. Eight anchors at 45° spacing.
  Ideator #4DD0E1 cyan · Artist #E91E63 magenta · Builder #FF8A3D orange ·
  Launcher #FFFFFF white · Voice #FFB300 amber · Trader #7CFF6B green ·
  Shield #FF3B30 red · Recruiter #B388FF violet
On Launch.started all eight IGNITE within 100ms: each grows core→anchor
over 900ms (animate drawRange) with a bright head particle and 30
instanced trailing sparks. Simultaneous ignition IS the thesis; Agent G
measures the stagger.
While running, a strand carries PULSES: bright packets core→anchor at 1.5
units/s, one per <Worker>.progress event. The anchor glows with cumulative
progress.
State looks (distinct at a glance):
  running           pulses flowing, anchor brightening
  awaiting approval pulses stop; slow amber breathe (0.8s); small glass
                    ring at the anchor
  candidates        strand fans (6.4)
  done              strand locks solid, anchor seals with a glass cap and a
                    soft ring flash
  failed            desaturates to #3A4049 over 1.2s, one red pulse
                    anchor→core, the anchor CRACKS (visible fracture decal)
                    and stays cracked
Tapping a strand/anchor (44px min hit area) opens its WorkerSheet; that
strand brightens 1.5×, the others dim to 0.6×.

6.4 THE COLLAPSE — the signature moment
On <Worker>.candidates(N): over 600ms the tube splits into N ghost tubes
(radius 0.012, opacity 0.35, slight random curvature) spreading near the
anchor, each ending in a faint glass bead with a billboard label (name, or
48px thumbnail). The fan drifts. This is superposition.
On Orchestrator.collapsed(worker, chosen, proof), exactly:
  t=0       chamber dims to 40%; a white beam leaves the core upward and
            out of frame (entropy request), 200ms additive
  t=300ms   120 white photon sprites fall from above into the vessel
            (2px, short additive trails, 500ms), converging on the fan
  t=800ms   ghost tubes FLICKER: opacity 0.2↔0.6 at 24Hz for 400ms, beads
            jitter ±0.02
  t=1200ms  COLLAPSE: non-chosen tubes and beads vanish in one frame; the
            chosen tube snaps to full radius and brightness; a torus ring
            expands from the bead (radius 0.1→1.4, opacity 1→0, 450ms);
            the core flashes white for 2 frames; chromatic aberration
            spikes to 0.004 for 120ms then decays; the C6 tone plays
  t=1250ms  the proof hash types in beside the bead (JetBrains Mono 11px,
            #4DD0E1, 300ms character by character); tap opens the bundle
  t=1700ms  chamber returns to full brightness over 500ms
Every multi-candidate output uses this. It is the only animation that
snaps. Nothing else may use these effects.

6.5 THE LAUNCHER HANDOFF
When the Launcher begins the QSD launch, the camera dollies 7.5→4.2 over
1.2s onto the innermost tier and the chamber hosts the qsd-market
<LaunchSequence /> INSIDE this scene's render loop (same renderer, same
post-processing), rendering the real cryptographic stages on real events:
  key generation   67 hash chains growing link by link from the core, each
                   link a 0.05 glass cube on chainStep, 16 deep, in a
                   cylinder around the core
  merkle tree      chain tips fold to a leaf; 256 leaves rise; pairs fuse
                   level by level on treeLevelFused to one white root
  superposition    parameters as a shimmering band and a rotating
                   half-life ring around the core
  quantum draw     the 6.4 collapse sequence applied to the core
  signing          light runs down each chain to its signChainStop depth;
                   those 67 cubes lift out and lock into a ring; the auth
                   path to the root lights node by node
  anchoring        the signed state compacts to one bright packet, travels
                   a lane of light to a block that seals; the tx signature
                   types in beside it
The other seven strands stay visible around the frame. On anchoring, the
camera pulls back to 7.5 over 1.2s and the Launcher strand seals.
Import the sequence from qsd-market; write an adapter if needed; never fork.

6.6 LAUNCH.LIVE — the convergence
  t=0       every sealed strand sends one final bright pulse anchor→core
            at once
  t=900ms   pulses meet; the core flashes and expands (0.35→0.55 over
            600ms); its glass becomes a spherical frame around the coin's
            real logo on an inner sphere, lit from within
  t=1500ms  the CA types in beneath the core; the site URL beneath that;
            the strands relax to an idle shimmer
  t=1800ms  the CoinCard slides up over the lower 45% of the viewport
The chamber stays alive on the coin page: the long-lived workers' strands
pulse on their post-launch events, so an active agent visibly hums and a
paused one visibly rests. QSD decay shows as the core's glass clouding
(roughness 0.05→0.6); a measurement replays the 6.4 collapse on the core.

6.7 HARD RULES
- EVERY visual is driven by a real bus event. No timelines. Agent G feeds
  an empty stream (nothing moves) and a recorded stream (reproduces within
  tolerance). Pulse count equals progress event count.
- 60fps at 390×844 on a mid-range phone, all eight strands active, bloom
  on. Frame-time test under 4× CPU throttling: ≥55fps median through a
  full launch. Degrade in order: particles → bloom radius → DOF →
  iridescence → aberration. NEVER degrade strand count, pulse fidelity,
  the collapse sequence, or the chain link count.
- Single shared WebGLRenderer; instanced geometry for all repeats;
  dispose on unmount; no heap growth across a launch (Agent G checks).
- First frame under 2s on mobile data: vessel and core first, strands and
  post-processing stream in behind, interactive before bloom arrives.
- Reduced-motion: keep every state readable; replace shower, flicker and
  aberration with a 200ms fade; stop the orbit. Remove motion, never
  information.
- No textures except the coin's own logo after launch. No image assets.
  Entirely procedural, so it ships in kilobytes and looks the same
  everywhere.

6.8 TOKENS + KIT
Tokens: void #06080A · panel #0D1117 · border #1C2430 · probability
#4DD0E1 · collapse #E91E63 · decay #FFB300 · tunnel #F0F4F8 · text #D7DEE6
· muted #6B7684 · the eight worker colours. JetBrains Mono for all data
and logs; Space Grotesk 600 headings. Motion as in 6.1.
Kit: ConnectCard (X, wallet), PromptBox, LaunchButton, ThreadStrip (eight
tappable chips with live status), WorkerSheet (bottom sheet: log,
candidates, proof, outputs), ApprovalCard (approve / edit / skip,
swipeable), CoinCard (CA copy, site URL, image, X link, wallet, shield
status), ShieldReport, LogRow, EmptyState, AutopilotToggle. Storybook with
every strand state and the full collapse driven by a recorded fixture.
Every component has an honest empty and failed state.

DELIVER: <Chamber /> (idle, launch, live, coin-page modes), the kit, the
tokens, the frame-time test, and /docs/chamber.md explaining each visual's
meaning so copy never describes it wrong.

═══════════════════════════════════════════════════════════════════════════
7. AGENT E — CHAIN  (/packages/solana)
═══════════════════════════════════════════════════════════════════════════

- Import @qsd/crypto, @qsd/quantum, @qsd/protocol from qsd-market
  (workspace link or published). Never reimplement.
- Per-launch agent wallet: server-side keypair, encrypted at rest, SOL
  budget enforced in code.
- pump.fun launch via PumpPortal or current equivalent (research, confirm),
  dev buy, creator fee claiming. Emit Launcher.deployed(coinCa) the moment
  the deploy confirms.
- Trade execution for the Trader with slippage limits and tx logging.
- Name/ticker availability check and perceptual-hash logo search across
  recent pump.fun launches for the Shield; bundle and dev-wallet anomaly
  detection via Helius webhooks or equivalent.
- Chart milestones (mcap thresholds, holder counts via DAS) as events for
  the Voice and Builder.
- Register the coin with the QSD protocol after launch so decay,
  measurement and daughter creation run there; re-attach the agent to the
  daughter on Collapse.daughterBorn, and have the Builder publish the
  daughter's site with its lineage.
- Devnet by default. Mainnet behind an explicit integrator flag.

═══════════════════════════════════════════════════════════════════════════
8. AGENT F — APP  (/apps/web)
═══════════════════════════════════════════════════════════════════════════

Next.js 14 app router, TypeScript, Tailwind on the ui preset, Zustand,
TanStack Query, SSE for live events, Solana mobile wallet adapter, X OAuth.

ONBOARDING — two connections, nothing else
1. Connect X: the project's own account. One tap, OAuth, done.
2. Connect wallet: mobile wallet adapter first.
That is the entire setup. No profile, no form beyond the one prompt line.
Returning users skip straight to the prompt.

SCREENS (phone first, 390px)
/            THE SCREEN. Chamber on top. Below: the two ConnectCards
             (collapse to chips once connected), PromptBox with
             placeholder "a coin about…" and a "surprise me" chip, the
             LaunchButton, cost line (launch · dev buy · agent budget ·
             you pay). After the tap: eight ThreadStrip chips light,
             ApprovalCards slide in, the CoinCard forms on live. One
             screen; no navigation needed to launch.
/launch/[id] Same screen for any launch in progress or done,
             deep-linkable, with the full event log.
/coin/[ca]   The agent's ongoing life: chamber in coin-page mode, Voice
             feed, Trader log with reasons, Shield report, Recruiter
             outreach, site status and patch log, autopilot toggles,
             budgets, QSD decay status and daughter ghost.
/me          Your launches, agent wallets, budgets, connected accounts,
             pending approvals.
/status      API budgets, queue depth, provider health, hosting health.
/how         What each worker does, the quantum collapse, the gates, the
             budgets, what the agent will never do. Rendered from
             /docs/*.md verbatim.

Footer on every screen: "Quantagent runs parallel workers on verifiable
quantum randomness. It is not a mind and will not make a bad idea good.
Coins launch on pump.fun (Solana). A meme, not an investment."

═══════════════════════════════════════════════════════════════════════════
9. AGENT G — VERIFY  (/tests, /docs)  — adversarial, independent
═══════════════════════════════════════════════════════════════════════════

You did not see the code written. Treat it as untrusted.
- Measure worker start times on a real launch: all eight within 100ms.
- Kill a worker mid-launch: others finish; the launch reports partial
  success honestly.
- Attempt to post, reach out, or trade with approvals off and autopilot
  off. Impossible.
- Attempt to enable a pseudorandom provider in production. Impossible.
- Verify no code path creates an X account; the Voice posts only from a
  user-connected account.
- Time the CA handshake: Builder republish, Voice CA post (with autopilot
  on), Shield canonical registration, each within 5s of
  Launcher.deployed. Grep every rendered surface for any CA other than
  the deployed one. Zero tolerance.
- Feed the chamber an empty event stream: nothing moves. Feed a recorded
  stream: it reproduces. Count strands (8) and chain links (67×16).
- Run the chamber frame-time test; check heap across a launch.
- Exceed every budget: worker fails, launch survives.
- Replay a launch from its log: UI and chamber state identical.
- Audit every image for content rules; every post for duplicates and rate
  limits; every outreach for caps; every site patch for its trigger event.
- Write /docs/security.md and /docs/audit-log.md. Nothing ships with an
  open blocking finding.

═══════════════════════════════════════════════════════════════════════════
10. INTEGRATOR CHECKLIST
═══════════════════════════════════════════════════════════════════════════

[ ] SPEC.md at root matches this document.
[ ] All agents done with passing tests; Agent G has no open blockers.
[ ] From a cold phone, recorded in one take with no cuts: connect X →
    connect wallet → one line → tap → eight strands ignite together →
    quantum collapses with proofs → QSD sequence → real devnet coin →
    site live with the correct CA within 5s → CA posted from the
    connected X account → images in the gallery → dev buy executed →
    Shield report populated → CoinCard. Watch the video yourself. If the
    collapse doesn't make you want to watch it twice, the chamber is not
    done, whatever the tests say.
[ ] A second launch with autopilot on, left alone for an hour: the agent
    posted, traded within rules, updated the site, and logged every
    action with a reason.
[ ] No mock data, no canned animation, no placeholder anywhere.
[ ] Footer on every screen; /how renders the docs verbatim.

Report back with: what works end to end, what is devnet-only, what Agent
G left open, the exact env variables for mainnet, and the per-launch cost
in API calls, hosting, and SOL.# QUANTAGENT · quantagent.fun
# BUILD INSTRUCTIONS FOR CLAUDE CODE

You are the lead engineer on quantagent. Read this whole file, write it to
SPEC.md at the repo root, and re-read SPEC.md at the start of every session.

Run this build as a TEAM OF SUBAGENTS in parallel. Spawn them with the Agent
tool, give each its section verbatim, and act as integrator and reviewer.
Never build everything yourself serially: the product is about parallel
work, and so is the build.

═══════════════════════════════════════════════════════════════════════════
0. WHAT WE ARE BUILDING
═══════════════════════════════════════════════════════════════════════════

Connect your project's X account. Connect your wallet. Type one line. Tap.

Eight workers start simultaneously: Ideator, Artist, Builder, Launcher,
Voice, Trader, Shield, Recruiter. By the time the pump.fun transaction
confirms, the coin has a name, a full image set, a live website showing the
correct contract address, an announcement thread with the CA posted from the
project's own X account, a wallet that has already bought in, a shield
already scanning for copycats, and people already replied to. The agent then
keeps running: posting, trading, defending, recruiting, updating the site,
every action logged with a reason.

Quantum is not decoration. Parallel branches collapsing to one result is the
real idea of quantum computation. When workers produce multiple candidates
(five names, twelve images), a verifiable quantum random draw collapses the
choice, with proof. The coin's identity is genuinely undetermined until it
launches.

Launches run through the QSD protocol (qsd-market repo): hash-based
identity, superposition, quantum draw, signing, anchoring. When a coin goes
quiet it decays into a daughter with the same agent attached.

The chamber, the 3D view of all eight workers computing at once, is the
product's face. It gets the most effort of anything on the team.

LIVE ONLY. No mock coins, no fake posts, no simulated workers, no seeded
data. Every image is really generated, every post really posted, every site
really deployed, every trade really executed (devnet first). Empty states
render empty and honest.

═══════════════════════════════════════════════════════════════════════════
1. TEAM — spawn these agents
═══════════════════════════════════════════════════════════════════════════

Spawn A, B, C, D in parallel immediately. They share nothing but types.

AGENT A — "core"       /packages/core: orchestrator, worker runtime, event
                       bus, job state. Section 3.
AGENT B — "workers"    /packages/workers: the eight workers. Section 4.
                       Spawn EIGHT sub-agents, one per worker.
AGENT C — "chamber"    /packages/ui: tokens, phone-first kit, and THE
                       CHAMBER. Section 6. Spawn three sub-agents.
AGENT D — "x"          /packages/x: X client on the user's connected
                       account. Section 5.
AGENT E — "chain"      /packages/solana: QSD integration, pump.fun,
                       wallets, trades, holder data. Section 7. After A.
AGENT F — "app"        /apps/web: onboarding, the one screen, follow-up
                       screens. Section 8. After A, C.
AGENT G — "verify"     /tests, /docs: adversarial reviewer, never saw the
                       code written. Section 9. Starts when A and B
                       finish, runs continuously after.

RULES FOR ALL AGENTS
- Write only inside your owned directory plus your tests.
- Expose a typed public API from your package index, documented in a
  package README.
- Never stub, fake or hardcode a value the spec says must be produced. If
  it can't be done yet, throw NotImplemented with the reason and report.
- "Done" means tests pass, not that files exist.
- The integrator reviews every delivery against this spec and rejects
  anything that fakes a worker, hides a failure, posts without a log, or
  animates without an event.

Monorepo: pnpm workspaces + Turborepo, TypeScript strict. /apps/web,
/packages/{core,workers,ui,x,solana}. Shared types in /packages/core/types.

═══════════════════════════════════════════════════════════════════════════
2. NON-NEGOTIABLE QUALITY BARS
═══════════════════════════════════════════════════════════════════════════

- TRUE PARALLELISM. All eight workers start within 100ms of each other and
  run concurrently. Agent G measures this. A sequential pipeline dressed as
  parallel is a failed build.
- EVERYTHING LOGGED. Every worker action emits an event: what, why, inputs,
  outputs, external ids (tx signature, post id, image url, deploy id). The
  user can tap any strand and read the full reason chain.
- HUMAN GATE WHERE MONEY OR REPUTATION MOVES. First launch: the Voice's
  posts, the Recruiter's outreach, and the Trader's buys beyond the dev buy
  require a tap to approve. Autopilot is an explicit per-coin, per-action
  opt-in. Agent G verifies nothing posts, reaches out, or trades without
  approval or an enabled autopilot flag.
- THE CA IS NEVER WRONG. No post, page, or report ever shows a contract
  address other than the deployed one. "Pending launch" until deployed,
  then the real CA within 5 seconds everywhere.
- QUANTUM RANDOMNESS IS REAL. Candidate selection uses @qsd/quantum with
  attestation. No pseudorandom fallback in production (test that it's
  impossible). If the QRNG is unreachable, candidates are shown and the
  user picks; the UI says why.
- PHONE FIRST. Every screen designed at 390px first. Under 3 seconds to
  the launch screen on mobile data.
- NOTHING INVENTED. A missing image, a failed post, a failed deploy, a
  rejected trade is shown as exactly that. No placeholder content, ever.

═══════════════════════════════════════════════════════════════════════════
3. AGENT A — CORE  (/packages/core)
═══════════════════════════════════════════════════════════════════════════

ORCHESTRATOR
- launch(prompt, connections, options) creates a Launch job and starts all
  eight workers concurrently via Promise.allSettled over isolated worker
  contexts. Workers communicate ONLY through the event bus.
- Dependencies are event subscriptions, not call order. Every worker
  starts immediately and does whatever it can before its inputs arrive:
  the Artist generates from the prompt alone; the Builder scaffolds the
  site from the prompt alone; the Shield scans the prompt's keywords for
  pre-existing copycats.
- Collapse step: when a worker yields multiple candidates, the
  orchestrator requests one quantum draw from @qsd/quantum, records the
  proof bundle, selects, and emits Orchestrator.collapsed with the proof.

THE CA HANDSHAKE
Launcher.deployed(coinCa) is the most important event in the system. On it,
three workers react independently and simultaneously:
  Builder → patch CA block + buy link, republish site
  Voice   → post the CA with the site link (pre-drafted ApprovalCard
            waiting, so approval is one tap; instant if autopilot.posts)
  Shield  → register coinCa as canonical for all copycat comparison
Agent G asserts all three react within 5 seconds on a real devnet launch.

EVENT BUS
- Typed events: Launch.started, <Worker>.started, <Worker>.progress,
  <Worker>.candidates, Orchestrator.collapsed(worker, chosen, proof),
  <Worker>.awaitingApproval, <Worker>.done, <Worker>.failed(reason),
  Launcher.deployed(coinCa), Builder.published(url), Launch.live,
  Launch.failed, and post-launch events per worker.
- Persistent (Postgres) and streamed (Redis pub/sub → SSE). Replayable: a
  Launch's event log reconstructs UI and chamber state exactly.

WORKER RUNTIME
- Interface: start(ctx), on(event), stop(). ctx carries the prompt, launch
  id, scoped LLM / image / X / Solana / hosting clients, and emit().
- Per-worker budgets (tokens, API calls, SOL, deploys) enforced in ctx;
  exceeding a budget fails the worker, never the launch.
- ctx.requireApproval(action) blocks until the user taps approve or
  autopilot is on for that action class.

STATE
- Launch { id, prompt, ownerWallet, xAccountId, status, startedAt, liveAt?,
  coinCa?, siteUrl?, agentWallet, autopilot: { posts, trades, recruiting },
  workers: Record<WorkerName, WorkerState> }
- WorkerState { status, startedAt, doneAt?, candidates?, chosen?, proof?,
  outputs: Record<string, unknown>, failReason? }

POST-LAUNCH RUNTIME
- After Launch.live, Voice, Trader, Shield, Recruiter, Builder and Artist
  run as long-lived BullMQ workers on the same bus, budgets and gates.
  Ideator runs on demand from the Voice.

TESTS: eight starts within 100ms; isolation (a crashed worker cannot crash
another); replay fidelity; gate enforcement; budget enforcement; CA
handshake timing.

═══════════════════════════════════════════════════════════════════════════
4. AGENT B — WORKERS  (/packages/workers)  — eight sub-agents
═══════════════════════════════════════════════════════════════════════════

Each worker is its own folder with its own tests, emits the full event
vocabulary, and writes a one-line human reason for every output.

B1 IDEATOR
- Input: prompt (possibly empty). Pulls live X trends via Agent D.
- Output: 5 candidate identities { name, ticker, lore, hook, trend }.
  Emits Ideator.candidates; the orchestrator collapses.
- Constraints: ticker ≤ 6 chars, name not live on pump.fun (Agent E), no
  real person's name, no protected brand.
- Post-launch: on Voice.needsAngle, 3 new angles from mentions and chart.

B2 ARTIST
- Starts from the prompt alone; re-renders with the final name once
  chosen. Output: logo (square), banner (X header), 6–12 character images
  in one consistent style. Emits Artist.candidates for the logo; the
  orchestrator collapses the choice with a quantum draw.
- Pluggable image provider (research current options; integrator supplies
  keys). Object storage; emit urls. Content rules in code: no real people,
  no protected characters or brands, nothing sexual or violent. A failed
  generation is logged, never replaced with a stock image.
- Post-launch: on Voice.needsImage(brief) or Builder.needsAsset, generate.

B3 BUILDER
- Starts at t=0 from the prompt: scaffolds a single-page site in the QSD
  aesthetic (void, glass, mono) from a pre-built static template with
  placeholder blocks that fill as events arrive: Ideator.named →
  title/ticker/lore; Artist.logoReady → favicon/hero; Artist.imageReady →
  gallery; Launcher.deployed → CA block, pump.fun buy button, chart embed;
  Voice.posted → embed of the announcement thread.
- Publishes to <ticker>.quantagent.site within 15 seconds of t=0, BEFORE
  the coin exists, so the Voice's first post can link to it. CA block shows
  "CA: pending launch" with a live indicator until deployed.
- On Launcher.deployed: patch + republish within 5 seconds. Agent G times
  it. Hosting via an edge adapter with no build step (content injected at
  publish, pushed to Cloudflare Pages / Vercel API / own edge — research).
  Custom-domain connect for users who have one. HTTPS. OG image from logo
  + ticker so the link unfurls on X.
- Post-launch: site updates on Voice.posted (feed), Artist.imageReady
  (gallery), chart milestones (live stat strip), Shield.copycatFound
  ("verify the real CA" banner). Every patch logged with its trigger.

B4 LAUNCHER
- Input: chosen identity + logo. Runs the QSD launch end to end via Agent
  E: identity key, superposition params, quantum draw, signing, anchoring,
  pump.fun deploy with dev buy. Emits every QSD stage event so the chamber
  renders the cryptographic sequence. Emits Launcher.deployed(coinCa).
- Output: coinCa, tx signatures, identity root, proof bundle.

B5 VOICE
- Posts ONLY from the X account the user connected (Agent D). Sets avatar
  and banner from the Artist.
- At launch: announcement thread (hook, lore, site link, first two
  images), then the CA post on Launcher.deployed. Gated unless
  autopilot.posts; approval cards are pre-drafted so approval is one tap.
- Post-launch: replies to mentions, reacts to chart milestones, posts new
  images, asks the Ideator for angles when engagement drops. Platform
  rate limits honoured. Every post logged with reason and post id. Never
  posts the same text twice.

B6 TRADER
- Controls the agent wallet (Agent E). At launch: the dev buy only.
- Post-launch rules (deterministic, /docs/trading.md): support buys on
  defined dips within budget, no selling in the first 24h, one-line reason
  per trade, every tx signature logged. Gated unless autopilot.trades.
  Never trades another coin. Never exceeds the SOL budget.

B7 SHIELD
- From t=0: scans pump.fun and X for coins using the chosen name, ticker,
  or a perceptual-hash match of the logo (Agent E + D).
- On Launcher.deployed: registers the real CA as canonical.
- On a match: files it on the coin page with evidence; has the Voice flag
  it publicly (gated like a post); has the Builder raise the site banner.
  Detects bundled launches of the coin's own CA and dev-wallet anomalies.
- Output: live Shield report { canonicalCa, copycats[], bundleFlags[] }.

B8 RECRUITER
- Finds accounts actively posting about the narrative via Agent D's
  search; ranks by relevance and reach; drafts replies and invitations.
  Gated unless autopilot.recruiting. Hard caps per hour. Never DMs. Never
  bulk follows. Logs every outreach.

═══════════════════════════════════════════════════════════════════════════
5. AGENT D — X  (/packages/x)
═══════════════════════════════════════════════════════════════════════════

- OAuth 2.0 PKCE on the PROJECT'S OWN account: tweet.read, tweet.write,
  users.read, offline.access, media upload. Tokens encrypted at rest.
- NO account provisioning anywhere in the codebase. The Voice posts only
  from accounts the user connected. Document this.
- Posting, threads, media upload, replies, mentions polling, search
  (trends and narrative discovery), profile update (avatar, banner).
- Token-bucket rate limiter per account and globally; honour reset
  headers; backoff on 429; dead-letter queue with visible retry.
- Monthly call budget with a /status readout. At 100%, posting pauses and
  the UI says so.

═══════════════════════════════════════════════════════════════════════════
6. AGENT C — THE CHAMBER  (/packages/ui)  ← highest effort on the team
═══════════════════════════════════════════════════════════════════════════

You own what a person on a phone SEES while their coin is being made. It
must feel like standing inside a quantum computer: a machine made of light,
visibly computing, eight processes running at once and collapsing into one
result. Not a loading screen. Not a progress bar.

Sub-agents: C1 "materials+scene" (vessel, lighting, glass, post-processing),
C2 "strands+collapse" (the eight strands and the collapse events),
C3 "performance" (instancing, LOD, mobile profiling, degradation).

6.1 THE AESTHETIC — write this down before any code
A real quantum computer is a dilution refrigerator: a gold-and-copper
chandelier of nested cylinders in a cryostat near absolute zero. We render
that as pure light and glass in a void. Nothing opaque, nothing textured.
- VOID. #06080A with a faint cold radial gradient to #0B1220 at the edges.
  No skybox, no grid. Depth from fog (near 8, far 40, #06080A) and
  depth-of-field, not scenery.
- GLASS. MeshPhysicalMaterial: transmission 1.0, thickness 0.4–1.2, ior
  1.45, roughness 0.05–0.15, iridescence 0.6, iridescenceIOR 1.3. Rim key
  light in #4DD0E1 behind the vessel so edges glow against the void.
- LIGHT IS COMPUTATION. Idle = dim glass. Active = emissive #FFE6F2 at
  intensity 2–4, caught by UnrealBloom (strength 0.9, radius 0.6,
  threshold 0.75). Whatever is computing is the brightest thing on screen.
- COLD. 200 instanced additive points, size 0.02, drifting 0.05 units/s:
  cryogenic vapour. Always on, always subtle.
- MOTION. Nothing snaps except a collapse. cubic-bezier(0.4,0,0.2,1),
  700ms+. Light travels at a visible pace, like a pulse down a fibre. The
  camera drifts constantly (0.3°/s orbit, 2% dolly breathing).
- SOUND (off by default). Procedural Web Audio: a 55Hz cryogenic hum with
  a soft octave harmonic rising with total worker activity; a pure C6 tone
  (300ms, soft attack) on every collapse. No audio files.

6.2 THE VESSEL
Eight nested glass cylinders (radius 3.0 → 0.6, 0.08 thick) hanging from a
glass plate, eight glass pylons per tier (the chandelier). The innermost
holds THE CORE: a sphere, radius 0.35, representing the coin.
Idle: dim glass, cyan edges, core pulsing (emissive 0.3↔0.6 over 2.4s),
vapour drifting, camera orbiting. Beautiful enough to screenshot alone.
Portrait: vessel fills the top 55% of 390×844, camera (0, 1.2, 7.5) looking
at (0, 0.4, 0), fov 38. Wider viewports widen the frame, never the
composition.

6.3 THE EIGHT STRANDS
Each worker is a STRAND: a tube of light (TubeGeometry on a CatmullRom
curve, radius 0.025, 64 segments, emissive in its colour) spiralling from
the core outward through the tiers to its anchor on the outermost
cylinder. Eight anchors at 45° spacing.
  Ideator #4DD0E1 cyan · Artist #E91E63 magenta · Builder #FF8A3D orange ·
  Launcher #FFFFFF white · Voice #FFB300 amber · Trader #7CFF6B green ·
  Shield #FF3B30 red · Recruiter #B388FF violet
On Launch.started all eight IGNITE within 100ms: each grows core→anchor
over 900ms (animate drawRange) with a bright head particle and 30
instanced trailing sparks. Simultaneous ignition IS the thesis; Agent G
measures the stagger.
While running, a strand carries PULSES: bright packets core→anchor at 1.5
units/s, one per <Worker>.progress event. The anchor glows with cumulative
progress.
State looks (distinct at a glance):
  running           pulses flowing, anchor brightening
  awaiting approval pulses stop; slow amber breathe (0.8s); small glass
                    ring at the anchor
  candidates        strand fans (6.4)
  done              strand locks solid, anchor seals with a glass cap and a
                    soft ring flash
  failed            desaturates to #3A4049 over 1.2s, one red pulse
                    anchor→core, the anchor CRACKS (visible fracture decal)
                    and stays cracked
Tapping a strand/anchor (44px min hit area) opens its WorkerSheet; that
strand brightens 1.5×, the others dim to 0.6×.

6.4 THE COLLAPSE — the signature moment
On <Worker>.candidates(N): over 600ms the tube splits into N ghost tubes
(radius 0.012, opacity 0.35, slight random curvature) spreading near the
anchor, each ending in a faint glass bead with a billboard label (name, or
48px thumbnail). The fan drifts. This is superposition.
On Orchestrator.collapsed(worker, chosen, proof), exactly:
  t=0       chamber dims to 40%; a white beam leaves the core upward and
            out of frame (entropy request), 200ms additive
  t=300ms   120 white photon sprites fall from above into the vessel
            (2px, short additive trails, 500ms), converging on the fan
  t=800ms   ghost tubes FLICKER: opacity 0.2↔0.6 at 24Hz for 400ms, beads
            jitter ±0.02
  t=1200ms  COLLAPSE: non-chosen tubes and beads vanish in one frame; the
            chosen tube snaps to full radius and brightness; a torus ring
            expands from the bead (radius 0.1→1.4, opacity 1→0, 450ms);
            the core flashes white for 2 frames; chromatic aberration
            spikes to 0.004 for 120ms then decays; the C6 tone plays
  t=1250ms  the proof hash types in beside the bead (JetBrains Mono 11px,
            #4DD0E1, 300ms character by character); tap opens the bundle
  t=1700ms  chamber returns to full brightness over 500ms
Every multi-candidate output uses this. It is the only animation that
snaps. Nothing else may use these effects.

6.5 THE LAUNCHER HANDOFF
When the Launcher begins the QSD launch, the camera dollies 7.5→4.2 over
1.2s onto the innermost tier and the chamber hosts the qsd-market
<LaunchSequence /> INSIDE this scene's render loop (same renderer, same
post-processing), rendering the real cryptographic stages on real events:
  key generation   67 hash chains growing link by link from the core, each
                   link a 0.05 glass cube on chainStep, 16 deep, in a
                   cylinder around the core
  merkle tree      chain tips fold to a leaf; 256 leaves rise; pairs fuse
                   level by level on treeLevelFused to one white root
  superposition    parameters as a shimmering band and a rotating
                   half-life ring around the core
  quantum draw     the 6.4 collapse sequence applied to the core
  signing          light runs down each chain to its signChainStop depth;
                   those 67 cubes lift out and lock into a ring; the auth
                   path to the root lights node by node
  anchoring        the signed state compacts to one bright packet, travels
                   a lane of light to a block that seals; the tx signature
                   types in beside it
The other seven strands stay visible around the frame. On anchoring, the
camera pulls back to 7.5 over 1.2s and the Launcher strand seals.
Import the sequence from qsd-market; write an adapter if needed; never fork.

6.6 LAUNCH.LIVE — the convergence
  t=0       every sealed strand sends one final bright pulse anchor→core
            at once
  t=900ms   pulses meet; the core flashes and expands (0.35→0.55 over
            600ms); its glass becomes a spherical frame around the coin's
            real logo on an inner sphere, lit from within
  t=1500ms  the CA types in beneath the core; the site URL beneath that;
            the strands relax to an idle shimmer
  t=1800ms  the CoinCard slides up over the lower 45% of the viewport
The chamber stays alive on the coin page: the long-lived workers' strands
pulse on their post-launch events, so an active agent visibly hums and a
paused one visibly rests. QSD decay shows as the core's glass clouding
(roughness 0.05→0.6); a measurement replays the 6.4 collapse on the core.

6.7 HARD RULES
- EVERY visual is driven by a real bus event. No timelines. Agent G feeds
  an empty stream (nothing moves) and a recorded stream (reproduces within
  tolerance). Pulse count equals progress event count.
- 60fps at 390×844 on a mid-range phone, all eight strands active, bloom
  on. Frame-time test under 4× CPU throttling: ≥55fps median through a
  full launch. Degrade in order: particles → bloom radius → DOF →
  iridescence → aberration. NEVER degrade strand count, pulse fidelity,
  the collapse sequence, or the chain link count.
- Single shared WebGLRenderer; instanced geometry for all repeats;
  dispose on unmount; no heap growth across a launch (Agent G checks).
- First frame under 2s on mobile data: vessel and core first, strands and
  post-processing stream in behind, interactive before bloom arrives.
- Reduced-motion: keep every state readable; replace shower, flicker and
  aberration with a 200ms fade; stop the orbit. Remove motion, never
  information.
- No textures except the coin's own logo after launch. No image assets.
  Entirely procedural, so it ships in kilobytes and looks the same
  everywhere.

6.8 TOKENS + KIT
Tokens: void #06080A · panel #0D1117 · border #1C2430 · probability
#4DD0E1 · collapse #E91E63 · decay #FFB300 · tunnel #F0F4F8 · text #D7DEE6
· muted #6B7684 · the eight worker colours. JetBrains Mono for all data
and logs; Space Grotesk 600 headings. Motion as in 6.1.
Kit: ConnectCard (X, wallet), PromptBox, LaunchButton, ThreadStrip (eight
tappable chips with live status), WorkerSheet (bottom sheet: log,
candidates, proof, outputs), ApprovalCard (approve / edit / skip,
swipeable), CoinCard (CA copy, site URL, image, X link, wallet, shield
status), ShieldReport, LogRow, EmptyState, AutopilotToggle. Storybook with
every strand state and the full collapse driven by a recorded fixture.
Every component has an honest empty and failed state.

DELIVER: <Chamber /> (idle, launch, live, coin-page modes), the kit, the
tokens, the frame-time test, and /docs/chamber.md explaining each visual's
meaning so copy never describes it wrong.

═══════════════════════════════════════════════════════════════════════════
7. AGENT E — CHAIN  (/packages/solana)
═══════════════════════════════════════════════════════════════════════════

- Import @qsd/crypto, @qsd/quantum, @qsd/protocol from qsd-market
  (workspace link or published). Never reimplement.
- Per-launch agent wallet: server-side keypair, encrypted at rest, SOL
  budget enforced in code.
- pump.fun launch via PumpPortal or current equivalent (research, confirm),
  dev buy, creator fee claiming. Emit Launcher.deployed(coinCa) the moment
  the deploy confirms.
- Trade execution for the Trader with slippage limits and tx logging.
- Name/ticker availability check and perceptual-hash logo search across
  recent pump.fun launches for the Shield; bundle and dev-wallet anomaly
  detection via Helius webhooks or equivalent.
- Chart milestones (mcap thresholds, holder counts via DAS) as events for
  the Voice and Builder.
- Register the coin with the QSD protocol after launch so decay,
  measurement and daughter creation run there; re-attach the agent to the
  daughter on Collapse.daughterBorn, and have the Builder publish the
  daughter's site with its lineage.
- Devnet by default. Mainnet behind an explicit integrator flag.

═══════════════════════════════════════════════════════════════════════════
8. AGENT F — APP  (/apps/web)
═══════════════════════════════════════════════════════════════════════════

Next.js 14 app router, TypeScript, Tailwind on the ui preset, Zustand,
TanStack Query, SSE for live events, Solana mobile wallet adapter, X OAuth.

ONBOARDING — two connections, nothing else
1. Connect X: the project's own account. One tap, OAuth, done.
2. Connect wallet: mobile wallet adapter first.
That is the entire setup. No profile, no form beyond the one prompt line.
Returning users skip straight to the prompt.

SCREENS (phone first, 390px)
/            THE SCREEN. Chamber on top. Below: the two ConnectCards
             (collapse to chips once connected), PromptBox with
             placeholder "a coin about…" and a "surprise me" chip, the
             LaunchButton, cost line (launch · dev buy · agent budget ·
             you pay). After the tap: eight ThreadStrip chips light,
             ApprovalCards slide in, the CoinCard forms on live. One
             screen; no navigation needed to launch.
/launch/[id] Same screen for any launch in progress or done,
             deep-linkable, with the full event log.
/coin/[ca]   The agent's ongoing life: chamber in coin-page mode, Voice
             feed, Trader log with reasons, Shield report, Recruiter
             outreach, site status and patch log, autopilot toggles,
             budgets, QSD decay status and daughter ghost.
/me          Your launches, agent wallets, budgets, connected accounts,
             pending approvals.
/status      API budgets, queue depth, provider health, hosting health.
/how         What each worker does, the quantum collapse, the gates, the
             budgets, what the agent will never do. Rendered from
             /docs/*.md verbatim.

Footer on every screen: "Quantagent runs parallel workers on verifiable
quantum randomness. It is not a mind and will not make a bad idea good.
Coins launch on pump.fun (Solana). A meme, not an investment."

═══════════════════════════════════════════════════════════════════════════
9. AGENT G — VERIFY  (/tests, /docs)  — adversarial, independent
═══════════════════════════════════════════════════════════════════════════

You did not see the code written. Treat it as untrusted.
- Measure worker start times on a real launch: all eight within 100ms.
- Kill a worker mid-launch: others finish; the launch reports partial
  success honestly.
- Attempt to post, reach out, or trade with approvals off and autopilot
  off. Impossible.
- Attempt to enable a pseudorandom provider in production. Impossible.
- Verify no code path creates an X account; the Voice posts only from a
  user-connected account.
- Time the CA handshake: Builder republish, Voice CA post (with autopilot
  on), Shield canonical registration, each within 5s of
  Launcher.deployed. Grep every rendered surface for any CA other than
  the deployed one. Zero tolerance.
- Feed the chamber an empty event stream: nothing moves. Feed a recorded
  stream: it reproduces. Count strands (8) and chain links (67×16).
- Run the chamber frame-time test; check heap across a launch.
- Exceed every budget: worker fails, launch survives.
- Replay a launch from its log: UI and chamber state identical.
- Audit every image for content rules; every post for duplicates and rate
  limits; every outreach for caps; every site patch for its trigger event.
- Write /docs/security.md and /docs/audit-log.md. Nothing ships with an
  open blocking finding.

═══════════════════════════════════════════════════════════════════════════
10. INTEGRATOR CHECKLIST
═══════════════════════════════════════════════════════════════════════════

[ ] SPEC.md at root matches this document.
[ ] All agents done with passing tests; Agent G has no open blockers.
[ ] From a cold phone, recorded in one take with no cuts: connect X →
    connect wallet → one line → tap → eight strands ignite together →
    quantum collapses with proofs → QSD sequence → real devnet coin →
    site live with the correct CA within 5s → CA posted from the
    connected X account → images in the gallery → dev buy executed →
    Shield report populated → CoinCard. Watch the video yourself. If the
    collapse doesn't make you want to watch it twice, the chamber is not
    done, whatever the tests say.
[ ] A second launch with autopilot on, left alone for an hour: the agent
    posted, traded within rules, updated the site, and logged every
    action with a reason.
[ ] No mock data, no canned animation, no placeholder anywhere.
[ ] Footer on every screen; /how renders the docs verbatim.

Report back with: what works end to end, what is devnet-only, what Agent
G left open, the exact env variables for mainnet, and the per-launch cost
in API calls, hosting, and SOL.