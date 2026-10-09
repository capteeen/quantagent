/**
 * Wait for Launcher.deployed without ever deadlocking the launch: the orchestrator
 * emits Launch.failed only after every worker's start() has settled, so a worker that
 * waits for the coin must also give up when the Launcher fails. Used by the Voice,
 * Trader and Shield.
 */

import type { EventOf } from "@quantagent/core/types";
import type { WorkerContext } from "../context";

export class LauncherFailed extends Error {
  override readonly name = "LauncherFailed";
  constructor(public readonly launcherReason: string) {
    super(`Launcher failed before deploying a coin: ${launcherReason}`);
  }
}

/**
 * Resolves with the Launcher.deployed event, or throws LauncherFailed when the
 * Launcher's Worker.failed (or Launch.failed) arrives first. `already` short-circuits
 * when the caller's on() has already recorded the deploy.
 */
export async function waitForDeployed(
  ctx: WorkerContext,
  already?: () => EventOf<"Launcher.deployed">["payload"] | null,
): Promise<EventOf<"Launcher.deployed">["payload"]> {
  const seen = already?.();
  if (seen) return seen;

  const deployed = ctx.waitFor("Launcher.deployed");
  const launcherFailed = ctx.waitFor("Worker.failed", { predicate: (e) => e.worker === "Launcher" });
  const launchFailed = ctx.waitFor("Launch.failed");
  // Whichever waits lose the race are aborted/garbage later; never let them surface as unhandled.
  deployed.catch(() => undefined);
  launcherFailed.catch(() => undefined);
  launchFailed.catch(() => undefined);

  return Promise.race([
    deployed.then((e) => e.payload),
    launcherFailed.then((e) => {
      throw new LauncherFailed(e.payload.reason);
    }),
    launchFailed.then((e) => {
      throw new LauncherFailed(e.payload.reason);
    }),
  ]);
}
