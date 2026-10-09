/**
 * Variables this app reads from process.env (all optional; absence surfaces as
 * NotImplemented with the exact name). The core/solana/x/workers packages read
 * their own; see .env.example for the full list.
 */
declare namespace NodeJS {
  interface ProcessEnv {
    DATABASE_URL?: string | undefined;
    REDIS_URL?: string | undefined;
    SESSION_SECRET?: string | undefined;
    LLM_PROVIDER?: string | undefined;
    LLM_MODEL?: string | undefined;
    LLM_API_KEY?: string | undefined;
    ANTHROPIC_API_KEY?: string | undefined;
    ANTHROPIC_BASE_URL?: string | undefined;
    OPENAI_API_KEY?: string | undefined;
    OPENAI_BASE_URL?: string | undefined;
    SOLANA_CLUSTER?: string | undefined;
    LAUNCH_DEV_BUY_SOL?: string | undefined;
    TRADER_BUDGET_SOL?: string | undefined;
    NEXT_PUBLIC_SOLANA_CLUSTER?: string | undefined;
  }
}
