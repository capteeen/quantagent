import { z } from "zod";

export const IdentitySchema = z.object({
  name: z.string().min(1).max(32),
  ticker: z
    .string()
    .min(1)
    .max(12)
    .transform((t) => t.replace(/^\$/, "").toUpperCase().trim()),
  lore: z.string().min(1).max(600),
  hook: z.string().min(1).max(280),
  trend: z.string().min(1).max(120),
});

export const CandidatesSchema = z.object({
  candidates: z.array(IdentitySchema).min(1).max(8),
});

export const PersonCheckSchema = z.object({
  verdicts: z.array(
    z.object({
      name: z.string(),
      isRealPerson: z.boolean(),
      who: z.string().optional(),
    }),
  ),
});

export const AnglesSchema = z.object({
  angles: z.array(z.string().min(1).max(280)).min(3).max(3),
});

/** JSON schemas handed to LlmClient.complete so the client can constrain output. */
export const CANDIDATES_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["candidates"],
  properties: {
    candidates: {
      type: "array",
      minItems: 5,
      maxItems: 5,
      items: {
        type: "object",
        required: ["name", "ticker", "lore", "hook", "trend"],
        properties: {
          name: { type: "string" },
          ticker: { type: "string" },
          lore: { type: "string" },
          hook: { type: "string" },
          trend: { type: "string" },
        },
      },
    },
  },
};

export const PERSON_CHECK_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["verdicts"],
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "isRealPerson"],
        properties: {
          name: { type: "string" },
          isRealPerson: { type: "boolean" },
          who: { type: "string" },
        },
      },
    },
  },
};

export const ANGLES_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["angles"],
  properties: {
    angles: { type: "array", minItems: 3, maxItems: 3, items: { type: "string" } },
  },
};

/** Parse whatever the LLM returned (json field preferred, text fallback). */
export function parseLlmJson(result: { text: string; json?: unknown }): unknown {
  if (result.json !== undefined) return result.json;
  const text = result.text.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced?.[1] ?? text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("LLM response contained no JSON object");
  return JSON.parse(body.slice(start, end + 1));
}
