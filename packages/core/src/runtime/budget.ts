import { BudgetExceeded, type Budget, type BudgetUsage, type WorkerName } from "../../types/index";

export const BUDGET_DIMENSIONS: readonly (keyof Budget)[] = ["tokens", "apiCalls", "sol", "deploys"];

/**
 * Per-worker meter. `charge` throws BudgetExceeded the moment a dimension would
 * pass its cap; the caller (WorkerContext) emits the events and fails the worker.
 */
export class BudgetMeter {
  readonly budget: Readonly<Budget>;
  private readonly usage: BudgetUsage = { tokens: 0, apiCalls: 0, sol: 0, deploys: 0 };
  private blown: BudgetExceeded | null = null;

  constructor(
    readonly worker: WorkerName,
    budget: Budget,
  ) {
    this.budget = { ...budget };
  }

  get used(): Readonly<BudgetUsage> {
    return this.usage;
  }

  get exceeded(): BudgetExceeded | null {
    return this.blown;
  }

  charge(dimension: keyof Budget, amount: number): { used: number; limit: number } {
    if (!BUDGET_DIMENSIONS.includes(dimension)) throw new Error(`unknown budget dimension: ${String(dimension)}`);
    if (!Number.isFinite(amount) || amount < 0) throw new Error(`invalid spend amount for ${dimension}: ${amount}`);
    if (this.blown) throw this.blown;
    const limit = this.budget[dimension];
    const next = this.usage[dimension] + amount;
    if (next > limit) {
      this.usage[dimension] = next;
      this.blown = new BudgetExceeded(this.worker, dimension, limit, next);
      throw this.blown;
    }
    this.usage[dimension] = next;
    return { used: next, limit };
  }
}
