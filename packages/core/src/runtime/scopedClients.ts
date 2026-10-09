import type { ActionClass, Budget } from "../../types/index";
import type {
  HostingClient,
  ImageClient,
  LlmClient,
  QuantumClient,
  SolanaClient,
  XClient,
} from "../../types/clients";
import type { ClientsInput, WorkerClients } from "./worker";

export type Spend = (dimension: keyof Budget, amount: number) => void;

/**
 * The human gate as seen by a scoped client: called before a gated method runs.
 * Throws (ApprovalRequired) when neither autopilot nor an unconsumed approval
 * covers the action class; otherwise consumes one grant and returns.
 */
export type Guard = (actionClass: ActionClass, method: string) => void;

const NO_GUARD: Guard = () => undefined;

/**
 * Wraps the integrator's clients so every call is charged to the worker's budget
 * before it runs (apiCalls), plus tokens after an LLM completion, SOL before a
 * buy / dev buy, and deploys before a publish. Budget enforcement therefore does
 * not depend on worker discipline.
 *
 * With a `guard`, the methods where reputation or money moves are gated:
 * x.post / x.thread (class `postingClass`, "posts" by default, "recruiting" for
 * the Recruiter) and solana.buy / solana.sell ("trades"). The dev buy inside
 * deployPumpFun is not gated (the launch tap approved it).
 */
export function scopeClients(
  input: ClientsInput,
  spend: Spend,
  guard: Guard = NO_GUARD,
  postingClass: Extract<ActionClass, "posts" | "recruiting"> = "posts",
): WorkerClients {
  return {
    llm: input.llm ? scopeLlm(input.llm, spend) : null,
    image: input.image ? scopeImage(input.image, spend) : null,
    x: input.x ? scopeX(input.x, spend, guard, postingClass) : null,
    solana: input.solana ? scopeSolana(input.solana, spend, guard) : null,
    hosting: input.hosting ? scopeHosting(input.hosting, spend) : null,
    quantum: input.quantum ? scopeQuantum(input.quantum, spend) : null,
  };
}

function scopeLlm(c: LlmClient, spend: Spend): LlmClient {
  return {
    async complete(input) {
      spend("apiCalls", 1);
      const res = await c.complete(input);
      spend("tokens", res.tokensUsed);
      return res;
    },
  };
}

function scopeImage(c: ImageClient, spend: Spend): ImageClient {
  return {
    provider: c.provider,
    generate(input) {
      spend("apiCalls", 1);
      return c.generate(input);
    },
  };
}

function scopeX(c: XClient, spend: Spend, guard: Guard, postingClass: ActionClass): XClient {
  const call = <A extends unknown[], R>(fn: (...a: A) => Promise<R>) => (...a: A): Promise<R> => {
    spend("apiCalls", 1);
    return fn.apply(c, a);
  };
  return {
    accountId: c.accountId,
    post(input) {
      guard(postingClass, "x.post");
      spend("apiCalls", 1);
      return c.post(input);
    },
    thread(input) {
      guard(postingClass, "x.thread");
      spend("apiCalls", 1);
      return c.thread(input);
    },
    uploadMedia: call(c.uploadMedia),
    mentions: call(c.mentions),
    search: call(c.search),
    trends: call(c.trends),
    users: call(c.users),
    updateProfile: call(c.updateProfile),
    budget: call(c.budget),
  };
}

function scopeSolana(c: SolanaClient, spend: Spend, guard: Guard): SolanaClient {
  const call = <A extends unknown[], R>(fn: (...a: A) => Promise<R>) => (...a: A): Promise<R> => {
    spend("apiCalls", 1);
    return fn.apply(c, a);
  };
  return {
    cluster: c.cluster,
    agentWallet: c.agentWallet,
    qsdLaunch: call(c.qsdLaunch),
    deployPumpFun(input) {
      spend("apiCalls", 1);
      spend("sol", input.devBuySol);
      return c.deployPumpFun(input);
    },
    buy(input) {
      guard("trades", "solana.buy");
      spend("apiCalls", 1);
      spend("sol", input.sol);
      return c.buy(input);
    },
    sell(input) {
      guard("trades", "solana.sell");
      spend("apiCalls", 1);
      return c.sell(input);
    },
    claimCreatorFees: call(c.claimCreatorFees),
    isNameTaken: call(c.isNameTaken),
    findLogoMatches: call(c.findLogoMatches),
    findNameMatches: call(c.findNameMatches),
    watchAnomalies: call(c.watchAnomalies),
    watchMilestones: call(c.watchMilestones),
    registerWithQsd: call(c.registerWithQsd),
    balanceSol: call(c.balanceSol),
  };
}

function scopeHosting(c: HostingClient, spend: Spend): HostingClient {
  return {
    provider: c.provider,
    publish(input) {
      spend("apiCalls", 1);
      spend("deploys", 1);
      return c.publish(input);
    },
    connectCustomDomain(input) {
      spend("apiCalls", 1);
      return c.connectCustomDomain(input);
    },
  };
}

function scopeQuantum(c: QuantumClient, spend: Spend): QuantumClient {
  return {
    draw(input) {
      spend("apiCalls", 1);
      return c.draw(input);
    },
  };
}
