import { describe, expect, it } from "vitest";
import { BudgetExceeded, WORKER_NAMES, type ImageAsset } from "../types/index";
import type { ImageClient } from "../types/clients";
import { launch, stopLaunch } from "../src/orchestrator/launch";
import { BudgetMeter } from "../src/runtime/budget";
import { DEFAULT_BUDGETS } from "../src/state/index";
import { connections, liveOverrides, roster } from "./helpers";

function countingImage(): ImageClient & { calls: number } {
  const client = {
    provider: "test-image",
    calls: 0,
    async generate(input: { kind: ImageAsset["kind"]; width: number; height: number }): Promise<ImageAsset> {
      client.calls += 1;
      return { url: `https://img.test/${client.calls}`, kind: input.kind, width: input.width, height: input.height, externalId: `g${client.calls}` };
    },
  };
  return client;
}

describe("budget enforcement", () => {
  it("exceeding a budget through a scoped client fails that worker only; the launch goes on", async () => {
    const image = countingImage();
    let caught: unknown = null;
    const workers = roster({
      ...liveOverrides(),
      Artist: {
        start: async (ctx) => {
          try {
            for (let i = 0; i < 5; i++) {
              await ctx.clients.image!.generate({ prompt: "logo", kind: "logo", width: 512, height: 512 });
            }
          } catch (err) {
            caught = err;
            throw err;
          }
        },
      },
    });
    const handle = await launch("prompt", connections, { budgets: { Artist: { apiCalls: 2 } } }, { workers, clients: { image } });
    const state = await handle.settled;
    expect(image.calls).toBe(2); // the third call never reached the provider
    expect(caught).toBeInstanceOf(BudgetExceeded);
    expect((caught as BudgetExceeded).dimension).toBe("apiCalls");
    expect(state.workers.Artist.status).toBe("failed");
    expect(state.workers.Artist.failReason).toContain("apiCalls");
    expect(state.workers.Artist.budget.apiCalls).toBe(2);
    expect(state.workers.Artist.used.apiCalls).toBe(3);
    expect(state.status).toBe("partial");
    for (const n of WORKER_NAMES) if (n !== "Artist") expect(state.workers[n].status, n).toBe("done");

    const log = await handle.bus.log(handle.id);
    const exceeded = log.find((e) => e.type === "Worker.budgetExceeded");
    expect(exceeded && exceeded.type === "Worker.budgetExceeded" ? exceeded.payload : null).toEqual({ dimension: "apiCalls", limit: 2, used: 3 });
    expect(log.filter((e) => e.type === "Worker.spent" && e.worker === "Artist")).toHaveLength(2);
    await stopLaunch(handle.id);
  });

  it("ctx.spend enforces every dimension and the Launcher's SOL budget is the dev buy", async () => {
    let solErr: unknown = null;
    const workers = roster({
      Launcher: {
        start: (ctx) => {
          expect(ctx.budget.sol).toBe(0.25);
          ctx.spend("sol", 0.25);
          try {
            ctx.spend("sol", 0.0001);
          } catch (err) {
            solErr = err;
          }
        },
      },
      Ideator: {
        start: (ctx) => {
          ctx.spend("tokens", 10);
          ctx.spend("tokens", 5);
          expect(ctx.used.tokens).toBe(15);
        },
      },
    });
    const handle = await launch("prompt", connections, { devBuySol: 0.25 }, { workers, clients: {} });
    const state = await handle.settled;
    expect(solErr).toBeInstanceOf(BudgetExceeded);
    expect(state.workers.Launcher.status).toBe("failed");
    expect(state.workers.Ideator.status).toBe("done");
    expect(state.workers.Ideator.used.tokens).toBe(15);
    expect(state.status).toBe("failed"); // no coin was deployed
    await stopLaunch(handle.id);
  });

  it("no worker can spend SOL without an explicit budget", () => {
    for (const w of WORKER_NAMES) {
      if (w === "Trader") continue;
      expect(DEFAULT_BUDGETS[w].sol, w).toBe(0);
    }
    const meter = new BudgetMeter("Voice", DEFAULT_BUDGETS.Voice);
    expect(() => meter.charge("sol", 0.01)).toThrow(BudgetExceeded);
    expect(() => meter.charge("tokens", 1)).toThrow(BudgetExceeded); // a blown meter stays blown
    expect(() => new BudgetMeter("Voice", DEFAULT_BUDGETS.Voice).charge("tokens", -1)).toThrow(/invalid spend/);
  });
});
