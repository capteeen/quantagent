import {
  WORKER_NAMES,
  type Autopilot,
  type Budget,
  type Launch,
  type QuantagentEvent,
  type WorkerName,
  type WorkerState,
} from "../../types/index";

export const ZERO_BUDGET: Budget = { tokens: 0, apiCalls: 0, sol: 0, deploys: 0 };

/**
 * Default per-worker budgets. These are runtime caps, not spec'd outputs; the
 * integrator overrides them through LaunchOptions.budgets. `sol` is 0 for every
 * worker except the Launcher (dev buy) and the Trader, so nothing can spend SOL
 * without an explicit budget.
 */
export const DEFAULT_BUDGETS: Record<WorkerName, Budget> = {
  Ideator: { tokens: 120_000, apiCalls: 60, sol: 0, deploys: 0 },
  Artist: { tokens: 40_000, apiCalls: 60, sol: 0, deploys: 0 },
  Builder: { tokens: 120_000, apiCalls: 60, sol: 0, deploys: 25 },
  Launcher: { tokens: 10_000, apiCalls: 60, sol: 0, deploys: 0 },
  Voice: { tokens: 120_000, apiCalls: 120, sol: 0, deploys: 0 },
  Trader: { tokens: 40_000, apiCalls: 120, sol: 0.1, deploys: 0 },
  Shield: { tokens: 40_000, apiCalls: 200, sol: 0, deploys: 0 },
  Recruiter: { tokens: 80_000, apiCalls: 120, sol: 0, deploys: 0 },
};

export const DEFAULT_AUTOPILOT: Autopilot = { posts: false, trades: false, recruiting: false };

export function initialWorkerState(budget: Budget = ZERO_BUDGET): WorkerState {
  return { status: "pending", outputs: {}, budget: { ...budget }, used: { ...ZERO_BUDGET } };
}

/** A Launch before any event. Everything else comes from Launch.started. */
export function emptyLaunch(id: string): Launch {
  const workers = {} as Record<WorkerName, WorkerState>;
  for (const w of WORKER_NAMES) workers[w] = initialWorkerState();
  return {
    id,
    prompt: "",
    ownerWallet: "",
    xAccountId: "",
    status: "created",
    startedAt: "",
    agentWallet: "",
    autopilot: { ...DEFAULT_AUTOPILOT },
    cluster: "mainnet-beta",
    workers,
  };
}

function patchWorker(state: Launch, worker: WorkerName, patch: Partial<WorkerState>): Launch {
  const prev = state.workers[worker];
  return { ...state, workers: { ...state.workers, [worker]: { ...prev, ...patch } } };
}

/**
 * Pure reducer: (state, event) → state. Never mutates its inputs. Every field of
 * Launch / WorkerState is derived from events so rebuild(events) is exact.
 */
export function reduce(state: Launch, event: QuantagentEvent): Launch {
  switch (event.type) {
    case "Launch.started": {
      const p = event.payload;
      const workers = { ...state.workers };
      for (const w of WORKER_NAMES) {
        const budget = p.budgets?.[w];
        if (budget) workers[w] = { ...workers[w]!, budget: { ...budget } };
      }
      return {
        ...state,
        id: event.launchId,
        prompt: p.prompt,
        status: "running",
        startedAt: event.at,
        ownerWallet: p.ownerWallet ?? state.ownerWallet,
        xAccountId: p.xAccountId ?? state.xAccountId,
        agentWallet: p.agentWallet ?? state.agentWallet,
        autopilot: p.autopilot ? { ...p.autopilot } : state.autopilot,
        cluster: p.cluster ?? state.cluster,
        workers,
      };
    }
    case "Launch.live":
      return { ...state, status: "live", liveAt: event.at, coinCa: event.payload.coinCa, siteUrl: event.payload.siteUrl };
    case "Launch.partial":
      return { ...state, status: "partial" };
    case "Launch.failed":
      return { ...state, status: "failed" };
    case "Launch.autopilotChanged":
      return { ...state, autopilot: { ...event.payload.autopilot } };

    case "Worker.started":
      return patchWorker(state, event.worker, { status: "running", startedAt: event.at });
    case "Worker.progress":
      return state;
    case "Worker.candidates":
      return patchWorker(state, event.worker, { status: "candidates", candidates: event.payload.candidates });
    case "Worker.awaitingApproval":
      return patchWorker(state, event.worker, { status: "awaitingApproval" });
    case "Worker.approvalResolved": {
      const w = state.workers[event.worker];
      return w.status === "awaitingApproval" ? patchWorker(state, event.worker, { status: "running" }) : state;
    }
    case "Worker.done": {
      const w = state.workers[event.worker];
      if (w.status === "failed") return state; // a failure is never overwritten by a late done
      return patchWorker(state, event.worker, {
        status: "done",
        doneAt: event.at,
        outputs: { ...w.outputs, ...event.payload.outputs },
      });
    }
    case "Worker.failed":
      return patchWorker(state, event.worker, { status: "failed", doneAt: event.at, failReason: event.payload.reason });
    case "Worker.spent": {
      const w = state.workers[event.worker];
      return patchWorker(state, event.worker, { used: { ...w.used, [event.payload.dimension]: event.payload.used } });
    }
    case "Worker.budgetExceeded": {
      const w = state.workers[event.worker];
      return patchWorker(state, event.worker, { used: { ...w.used, [event.payload.dimension]: event.payload.used } });
    }

    case "Orchestrator.collapsed": {
      const w = state.workers[event.payload.worker];
      const status = w.status === "candidates" ? "running" : w.status;
      return patchWorker(state, event.payload.worker, {
        status,
        candidates: event.payload.candidates,
        chosen: event.payload.chosen,
        proof: event.payload.proof,
      });
    }
    case "Orchestrator.collapseUnavailable":
      return patchWorker(state, event.payload.worker, { status: "candidates", candidates: event.payload.candidates });
    case "Orchestrator.userPicked": {
      const w = state.workers[event.payload.worker];
      const status = w.status === "candidates" ? "running" : w.status;
      const { proof: _dropped, ...rest } = w;
      return { ...state, workers: { ...state.workers, [event.payload.worker]: { ...rest, status, chosen: event.payload.chosen } } };
    }

    case "Launcher.deployed":
      return { ...state, coinCa: event.payload.coinCa };
    case "Builder.published":
      return {
        ...state,
        siteUrl: event.payload.url,
        ...(state.coinCa && !state.siteCaPublishedAt ? { siteCaPublishedAt: event.at } : {}),
      };

    default:
      return state;
  }
}

/** Reconstructs a Launch from its event log alone. */
export function rebuild(events: readonly QuantagentEvent[], launchId?: string): Launch {
  const id = launchId ?? events[0]?.launchId ?? "";
  let state = emptyLaunch(id);
  for (const e of events) state = reduce(state, e);
  return state;
}

/** Workers whose status is failed. */
export function failedWorkers(state: Launch): WorkerName[] {
  return WORKER_NAMES.filter((w) => state.workers[w].status === "failed");
}
