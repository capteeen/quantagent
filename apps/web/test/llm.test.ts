import { describe, expect, it } from "vitest";
import { NotImplemented } from "@quantagent/core/types";
import { createAnthropicLlm, createOpenAiLlm, extractJson, llmClientFromEnv, validateJson, DEFAULT_ANTHROPIC_MODEL } from "@/server/llm";

type Call = { url: string; init: RequestInit };

function fakeFetch(respond: (call: Call) => unknown, status = 200): { fetch: (url: string, init?: RequestInit) => Promise<Response>; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    fetch: async (url, init = {}) => {
      const call = { url, init };
      calls.push(call);
      const body = respond(call);
      return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    },
  };
}

const SCHEMA = { type: "object", required: ["candidates"], properties: { candidates: { type: "array", minItems: 1, items: { type: "object", required: ["name", "ticker"], properties: { name: { type: "string" }, ticker: { type: "string" } } } } } };

describe("llm adapters", () => {
  it("anthropic: sends the Messages API request, asks for JSON, validates the schema", async () => {
    const f = fakeFetch(() => ({ content: [{ type: "text", text: '```json\n{"candidates":[{"name":"Cat","ticker":"CAT"}]}\n```' }], stop_reason: "end_turn", usage: { input_tokens: 40, output_tokens: 12 } }));
    const llm = createAnthropicLlm({ apiKey: "k", model: DEFAULT_ANTHROPIC_MODEL, fetch: f.fetch });
    const res = await llm.complete({ system: "name coins", user: "cats", schema: SCHEMA, maxTokens: 500 });
    expect(res.json).toEqual({ candidates: [{ name: "Cat", ticker: "CAT" }] });
    expect(res.tokensUsed).toBe(52);
    const call = f.calls[0]!;
    expect(call.url).toBe("https://api.anthropic.com/v1/messages");
    const headers = call.init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("k");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(String(call.init.body)) as { model: string; max_tokens: number; system: string; messages: { role: string; content: string }[] };
    expect(body.model).toBe(DEFAULT_ANTHROPIC_MODEL);
    expect(body.max_tokens).toBe(500);
    expect(body.system).toContain("JSON Schema");
    expect(body.messages).toEqual([{ role: "user", content: "cats" }]);
  });

  it("anthropic: a response that does not satisfy the schema is an error, never patched", async () => {
    const f = fakeFetch(() => ({ content: [{ type: "text", text: '{"candidates":[{"name":"Cat"}]}' }], stop_reason: "end_turn", usage: {} }));
    const llm = createAnthropicLlm({ apiKey: "k", model: "m", fetch: f.fetch });
    await expect(llm.complete({ system: "s", user: "u", schema: SCHEMA })).rejects.toThrow(/does not match the requested schema: \$\.candidates\[0\]\.ticker: required/);
  });

  it("anthropic: API errors and truncation surface with their real text", async () => {
    const bad = fakeFetch(() => ({ error: { type: "authentication_error", message: "invalid x-api-key" } }), 401);
    await expect(createAnthropicLlm({ apiKey: "k", model: "m", fetch: bad.fetch }).complete({ system: "s", user: "u" })).rejects.toThrow("Anthropic Messages API 401: authentication_error: invalid x-api-key");
    const cut = fakeFetch(() => ({ content: [{ type: "text", text: "{" }], stop_reason: "max_tokens", usage: {} }));
    await expect(createAnthropicLlm({ apiKey: "k", model: "m", fetch: cut.fetch }).complete({ system: "s", user: "u", maxTokens: 5 })).rejects.toThrow("truncated at max_tokens=5");
  });

  it("openai-compatible: uses OPENAI_BASE_URL, bearer auth and json_object mode", async () => {
    const f = fakeFetch(() => ({ choices: [{ message: { content: '{"candidates":[{"name":"Dog","ticker":"DOG"}]}' }, finish_reason: "stop" }], usage: { total_tokens: 77 } }));
    const llm = createOpenAiLlm({ apiKey: "ok", model: "gpt-x", baseUrl: "https://llm.example.test/v1/", fetch: f.fetch });
    const res = await llm.complete({ system: "s", user: "dogs", schema: SCHEMA });
    expect(res.json).toEqual({ candidates: [{ name: "Dog", ticker: "DOG" }] });
    expect(res.tokensUsed).toBe(77);
    const call = f.calls[0]!;
    expect(call.url).toBe("https://llm.example.test/v1/chat/completions");
    expect((call.init.headers as Record<string, string>)["authorization"]).toBe("Bearer ok");
    const body = JSON.parse(String(call.init.body)) as { response_format?: { type: string }; messages: { role: string }[] };
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages.map((m) => m.role)).toEqual(["system", "user"]);
  });

  it("selects by LLM_PROVIDER and names the missing variables", () => {
    expect(() => llmClientFromEnv({})).toThrow(NotImplemented);
    expect(() => llmClientFromEnv({})).toThrow(/LLM_PROVIDER/);
    expect(() => llmClientFromEnv({ LLM_PROVIDER: "anthropic" })).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => llmClientFromEnv({ LLM_PROVIDER: "openai" })).toThrow(/OPENAI_API_KEY/);
    expect(() => llmClientFromEnv({ LLM_PROVIDER: "other" })).toThrow(/not one of anthropic\|openai/);
    expect(llmClientFromEnv({ LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k" })).toBeDefined();
    expect(llmClientFromEnv({ LLM_PROVIDER: "openai", LLM_API_KEY: "k" })).toBeDefined();
  });

  it("extractJson and validateJson cover the shapes the workers use", () => {
    expect(extractJson('Sure! {"a":1} done')).toEqual({ a: 1 });
    expect(() => extractJson("no json here")).toThrow(/not JSON/);
    expect(validateJson({ accounts: [{ id: "1", relevance: 2 }] }, { type: "object", required: ["accounts"], properties: { accounts: { type: "array", items: { type: "object", required: ["id", "relevance"], properties: { id: { type: "string" }, relevance: { type: "number", minimum: 0, maximum: 1 } } } } } })).toEqual(["$.accounts[0].relevance: above maximum 1"]);
    expect(validateJson({ angles: ["a", "b"] }, { type: "object", required: ["angles"], properties: { angles: { type: "array", minItems: 3, maxItems: 3, items: { type: "string" } } } })).toEqual(["$.angles: fewer than 3 items"]);
    expect(validateJson({ text: "hi" }, { type: "object", properties: { text: { type: "string" } }, required: ["text"] })).toEqual([]);
  });
});
