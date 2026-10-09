/**
 * LlmClient (core/types/clients) adapters. No package ships one, so the app does:
 *
 *   LLM_PROVIDER=anthropic  → Anthropic Messages API over fetch (ANTHROPIC_API_KEY, LLM_MODEL)
 *   LLM_PROVIDER=openai     → OpenAI-compatible chat completions (OPENAI_API_KEY, OPENAI_BASE_URL, LLM_MODEL)
 *
 * A `schema` is enforced by asking for JSON only and validating the parsed value
 * against the JSON Schema subset the workers use (type, properties, required,
 * items, enum, min/max, minItems/maxItems, minLength/maxLength, additionalProperties).
 * A response that is not valid JSON or does not satisfy the schema throws; it is
 * never patched or defaulted.
 */
import type { Env } from "./types";
import { NotImplemented } from "@quantagent/core/types";
import type { LlmClient } from "@quantagent/core/types/clients";

export const LLM_PROVIDERS = ["anthropic", "openai"] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-5";
export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
export const ANTHROPIC_API_URL = "https://api.anthropic.com";
export const ANTHROPIC_VERSION = "2023-06-01";
export const OPENAI_API_URL = "https://api.openai.com/v1";
export const DEFAULT_MAX_TOKENS = 4096;

export const LLM_NEEDS = ["LLM_PROVIDER=anthropic|openai", "ANTHROPIC_API_KEY | OPENAI_API_KEY (or LLM_API_KEY)", "LLM_MODEL (optional)"];

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface LlmAdapterOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetch?: FetchLike;
}

/* ───────────────────────── JSON extraction + validation ───────────────────────── */

/** Parses the model's text as JSON, tolerating a fenced block or prose around one JSON value. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through */
  }
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fence?.[1]) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      /* fall through */
    }
  }
  const starts = [trimmed.indexOf("{"), trimmed.indexOf("[")].filter((i) => i >= 0);
  const ends = [trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]")].filter((i) => i >= 0);
  if (starts.length && ends.length) {
    const s = Math.min(...starts);
    const e = Math.max(...ends);
    if (e > s) {
      try {
        return JSON.parse(trimmed.slice(s, e + 1));
      } catch {
        /* fall through */
      }
    }
  }
  throw new Error(`LLM response is not JSON: ${trimmed.slice(0, 200)}`);
}

type Schema = Record<string, unknown>;

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/** Returns the list of violations; empty when `value` satisfies `schema`. */
export function validateJson(value: unknown, schema: Schema, path = "$"): string[] {
  const errors: string[] = [];
  const expected = schema["type"];
  const actual = typeOf(value);
  if (typeof expected === "string") {
    const ok =
      expected === actual ||
      (expected === "integer" && actual === "number" && Number.isInteger(value)) ||
      (expected === "number" && actual === "number");
    if (!ok) {
      errors.push(`${path}: expected ${expected}, got ${actual}`);
      return errors;
    }
  } else if (Array.isArray(expected)) {
    const ok = expected.some((t) => t === actual || (t === "integer" && actual === "number" && Number.isInteger(value)));
    if (!ok) {
      errors.push(`${path}: expected one of ${expected.join("|")}, got ${actual}`);
      return errors;
    }
  }
  if (Array.isArray(schema["enum"]) && !schema["enum"].some((e) => JSON.stringify(e) === JSON.stringify(value))) {
    errors.push(`${path}: not one of the allowed values`);
  }
  if (actual === "string") {
    const s = value as string;
    if (typeof schema["minLength"] === "number" && s.length < schema["minLength"]) errors.push(`${path}: shorter than ${schema["minLength"]}`);
    if (typeof schema["maxLength"] === "number" && s.length > schema["maxLength"]) errors.push(`${path}: longer than ${schema["maxLength"]}`);
  }
  if (actual === "number") {
    const n = value as number;
    if (typeof schema["minimum"] === "number" && n < schema["minimum"]) errors.push(`${path}: below minimum ${schema["minimum"]}`);
    if (typeof schema["maximum"] === "number" && n > schema["maximum"]) errors.push(`${path}: above maximum ${schema["maximum"]}`);
  }
  if (actual === "array") {
    const arr = value as unknown[];
    if (typeof schema["minItems"] === "number" && arr.length < schema["minItems"]) errors.push(`${path}: fewer than ${schema["minItems"]} items`);
    if (typeof schema["maxItems"] === "number" && arr.length > schema["maxItems"]) errors.push(`${path}: more than ${schema["maxItems"]} items`);
    const items = schema["items"];
    if (items && typeof items === "object" && !Array.isArray(items)) {
      arr.forEach((item, i) => errors.push(...validateJson(item, items as Schema, `${path}[${i}]`)));
    }
  }
  if (actual === "object") {
    const obj = value as Record<string, unknown>;
    const props = (schema["properties"] ?? {}) as Record<string, Schema>;
    const required = Array.isArray(schema["required"]) ? (schema["required"] as string[]) : [];
    for (const key of required) if (!(key in obj)) errors.push(`${path}.${key}: required`);
    for (const [key, sub] of Object.entries(props)) {
      if (key in obj) errors.push(...validateJson(obj[key], sub, `${path}.${key}`));
    }
    if (schema["additionalProperties"] === false) {
      for (const key of Object.keys(obj)) if (!(key in props)) errors.push(`${path}.${key}: not allowed`);
    }
  }
  return errors;
}

function jsonInstruction(schema: Schema): string {
  return [
    "Respond with exactly one JSON value and nothing else: no prose before or after it, no markdown code fences.",
    "The value must satisfy this JSON Schema:",
    JSON.stringify(schema),
  ].join("\n");
}

function finish(text: string, schema: Schema | undefined, tokensUsed: number): { text: string; json?: unknown; tokensUsed: number } {
  if (!schema) return { text, tokensUsed };
  const json = extractJson(text);
  const errors = validateJson(json, schema);
  if (errors.length) throw new Error(`LLM response does not match the requested schema: ${errors.join("; ")}`);
  return { text, json, tokensUsed };
}

async function readError(res: Response): Promise<string> {
  const body = await res.text().catch(() => "");
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string; type?: string } };
    if (parsed.error?.message) return `${parsed.error.type ? `${parsed.error.type}: ` : ""}${parsed.error.message}`;
  } catch {
    /* plain text */
  }
  return body.slice(0, 500);
}

/* ───────────────────────────── Anthropic ───────────────────────────── */

export function createAnthropicLlm(opts: LlmAdapterOptions): LlmClient {
  const fetchImpl = opts.fetch ?? fetch;
  const base = (opts.baseUrl ?? ANTHROPIC_API_URL).replace(/\/$/, "");
  return {
    async complete(input) {
      const system = input.schema ? `${input.system}\n\n${jsonInstruction(input.schema)}` : input.system;
      const res = await fetchImpl(`${base}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": opts.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model: opts.model,
          max_tokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
          system,
          messages: [{ role: "user", content: input.user }],
        }),
      });
      if (!res.ok) throw new Error(`Anthropic Messages API ${res.status}: ${await readError(res)}`);
      const body = (await res.json()) as {
        content?: { type: string; text?: string }[];
        stop_reason?: string;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      if (body.stop_reason === "refusal") throw new Error("Anthropic Messages API: the model refused this request (stop_reason=refusal)");
      const text = (body.content ?? [])
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text as string)
        .join("");
      if (body.stop_reason === "max_tokens") throw new Error(`Anthropic Messages API: output truncated at max_tokens=${input.maxTokens ?? DEFAULT_MAX_TOKENS}`);
      const tokensUsed = (body.usage?.input_tokens ?? 0) + (body.usage?.output_tokens ?? 0);
      return finish(text, input.schema, tokensUsed);
    },
  };
}

/* ───────────────────────────── OpenAI-compatible ───────────────────────────── */

export function createOpenAiLlm(opts: LlmAdapterOptions): LlmClient {
  const fetchImpl = opts.fetch ?? fetch;
  const base = (opts.baseUrl ?? OPENAI_API_URL).replace(/\/$/, "");
  return {
    async complete(input) {
      const system = input.schema ? `${input.system}\n\n${jsonInstruction(input.schema)}` : input.system;
      const res = await fetchImpl(`${base}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
        body: JSON.stringify({
          model: opts.model,
          max_tokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
          messages: [
            { role: "system", content: system },
            { role: "user", content: input.user },
          ],
          ...(input.schema ? { response_format: { type: "json_object" } } : {}),
        }),
      });
      if (!res.ok) throw new Error(`OpenAI-compatible API ${res.status} (${base}): ${await readError(res)}`);
      const body = (await res.json()) as {
        choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[];
        usage?: { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number };
      };
      const choice = body.choices?.[0];
      if (!choice) throw new Error(`OpenAI-compatible API (${base}): response had no choices`);
      if (choice.message?.refusal) throw new Error(`OpenAI-compatible API: the model refused this request: ${choice.message.refusal}`);
      if (choice.finish_reason === "length") throw new Error(`OpenAI-compatible API: output truncated at max_tokens=${input.maxTokens ?? DEFAULT_MAX_TOKENS}`);
      const text = choice.message?.content ?? "";
      const tokensUsed = body.usage?.total_tokens ?? (body.usage?.prompt_tokens ?? 0) + (body.usage?.completion_tokens ?? 0);
      return finish(text, input.schema, tokensUsed);
    },
  };
}

/* ───────────────────────────── env selection ───────────────────────────── */

export function llmProviderFromEnv(env: Env = process.env): LlmProvider {
  const provider = env["LLM_PROVIDER"]?.trim();
  if (!provider) throw new NotImplemented("LlmClient", "LLM_PROVIDER is not set", LLM_NEEDS);
  if (!(LLM_PROVIDERS as readonly string[]).includes(provider)) {
    throw new NotImplemented("LlmClient", `LLM_PROVIDER "${provider}" is not one of ${LLM_PROVIDERS.join("|")}`, ["LLM_PROVIDER=anthropic|openai"]);
  }
  return provider as LlmProvider;
}

export function llmClientFromEnv(env: Env = process.env, fetchImpl?: FetchLike): LlmClient {
  const provider = llmProviderFromEnv(env);
  const generic = env["LLM_API_KEY"]?.trim();
  const fetchOpt = fetchImpl ? { fetch: fetchImpl } : {};
  if (provider === "anthropic") {
    const apiKey = env["ANTHROPIC_API_KEY"]?.trim() || generic;
    if (!apiKey) throw new NotImplemented("LlmClient", "LLM_PROVIDER=anthropic but no API key is set", ["ANTHROPIC_API_KEY (or LLM_API_KEY)"]);
    const base = env["ANTHROPIC_BASE_URL"]?.trim();
    return createAnthropicLlm({ apiKey, model: env["LLM_MODEL"]?.trim() || DEFAULT_ANTHROPIC_MODEL, ...(base ? { baseUrl: base } : {}), ...fetchOpt });
  }
  const apiKey = env["OPENAI_API_KEY"]?.trim() || generic;
  if (!apiKey) throw new NotImplemented("LlmClient", "LLM_PROVIDER=openai but no API key is set", ["OPENAI_API_KEY (or LLM_API_KEY)", "OPENAI_BASE_URL (optional)"]);
  const base = env["OPENAI_BASE_URL"]?.trim();
  return createOpenAiLlm({ apiKey, model: env["LLM_MODEL"]?.trim() || DEFAULT_OPENAI_MODEL, ...(base ? { baseUrl: base } : {}), ...fetchOpt });
}

/** The model the env would use, for /status. Never throws. */
export function llmModelFromEnv(env: Env = process.env): string {
  const model = env["LLM_MODEL"]?.trim();
  if (model) return model;
  return env["LLM_PROVIDER"]?.trim() === "openai" ? DEFAULT_OPENAI_MODEL : DEFAULT_ANTHROPIC_MODEL;
}
