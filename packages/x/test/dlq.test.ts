import { describe, expect, it } from "vitest";
import { XThreadFailed } from "../src/errors";
import { MemoryDeadLetterQueue, RedisDeadLetterQueue, type RedisLike } from "../src/ratelimit/dlq";
import { FakeClock, buildClient, mockFetch, tweetsOk } from "./helpers";

function fakeRedis(): RedisLike & { hashes: Map<string, Map<string, string>>; kv: Map<string, string> } {
  const hashes = new Map<string, Map<string, string>>();
  const kv = new Map<string, string>();
  const h = (k: string) => hashes.get(k) ?? (hashes.set(k, new Map()), hashes.get(k)!);
  return {
    hashes,
    kv,
    async hset(k, f, v) {
      h(k).set(f, v);
      return 1;
    },
    async hget(k, f) {
      return h(k).get(f) ?? null;
    },
    async hgetall(k) {
      return Object.fromEntries(h(k));
    },
    async hdel(k, f) {
      return h(k).delete(f) ? 1 : 0;
    },
    async incrby(k, n) {
      const v = Number(kv.get(k) ?? 0) + n;
      kv.set(k, String(v));
      return v;
    },
    async get(k) {
      return kv.get(k) ?? null;
    },
  };
}

describe("DeadLetterQueue (memory + redis)", () => {
  for (const [name, make] of [
    ["memory", () => new MemoryDeadLetterQueue(new FakeClock().now)],
    ["redis", () => new RedisDeadLetterQueue(fakeRedis(), new FakeClock().now)],
  ] as const) {
    it(`${name}: add/list/get/retry/remove with a handler`, async () => {
      const dlq = make();
      let attempts = 0;
      dlq.setHandler("acc", "post", async (e) => {
        attempts++;
        if (attempts < 2) throw new Error("still broken");
        return { id: "999", input: e.input };
      });
      const entry = await dlq.add({ accountId: "acc", op: "post", input: { text: "hello" }, error: new Error("boom") });
      expect(entry).toMatchObject({ status: "failed", attempts: 1, error: "boom" });
      expect((await dlq.list()).map((e) => e.id)).toEqual([entry.id]);

      const r1 = await dlq.retry(entry.id);
      expect(r1.ok).toBe(false);
      expect(r1.entry).toMatchObject({ status: "failed", attempts: 2, error: "still broken" });
      expect(r1.entry.lastTriedAt).toBeDefined();

      const r2 = await dlq.retry(entry.id);
      expect(r2.ok).toBe(true);
      expect(r2.entry).toMatchObject({ status: "resolved", attempts: 3, result: { id: "999", input: { text: "hello" } } });
      expect((await dlq.get(entry.id))?.status).toBe("resolved");

      // Retrying a resolved entry does not re-run the handler.
      await dlq.retry(entry.id);
      expect(attempts).toBe(2);

      await dlq.remove(entry.id);
      expect(await dlq.get(entry.id)).toBeNull();
      await expect(dlq.retry(entry.id)).rejects.toThrow(/no dead letter/);
    });
  }

  it("reports a missing handler as a visible failure, and uses the default handler when set", async () => {
    const dlq = new MemoryDeadLetterQueue();
    const e = await dlq.add({ accountId: "acc", op: "post", input: {}, error: "x" });
    const r = await dlq.retry(e.id);
    expect(r).toMatchObject({ ok: false, error: "no handler for acc:post" });
    dlq.setDefaultHandler(async () => "via-default");
    expect(await dlq.retry(e.id)).toMatchObject({ ok: true, result: "via-default" });
  });

  it("lists newest first", async () => {
    const clock = new FakeClock();
    const dlq = new MemoryDeadLetterQueue(clock.now);
    const a = await dlq.add({ accountId: "acc", op: "post", input: 1, error: "a" });
    clock.advance(1000);
    const b = await dlq.add({ accountId: "acc", op: "post", input: 2, error: "b" });
    expect((await dlq.list()).map((e) => e.id)).toEqual([b.id, a.id]);
  });
});

describe("client ↔ DLQ integration", () => {
  it("a failed post is dead-lettered and retry(id) re-posts the same input", async () => {
    const clock = new FakeClock();
    const fetch = mockFetch(() => ({ status: 503, text: "down" }));
    const { client, dlq } = buildClient({ fetch, clock, maxAttempts: 2 });
    await expect(client.post({ text: "ship it", mediaIds: ["m1"] })).rejects.toMatchObject({ name: "XDeadLettered" });
    const [entry] = await dlq.list();
    expect(entry).toMatchObject({ op: "post", input: { text: "ship it", mediaIds: ["m1"] } });

    fetch.use(tweetsOk(500));
    const r = await dlq.retry(entry!.id);
    expect(r.ok).toBe(true);
    expect(r.entry.result).toMatchObject({ id: "500", text: "ship it" });
    const last = fetch.calls.at(-1)!;
    expect(last.body).toEqual({ text: "ship it", media: { media_ids: ["m1"] } });
    expect((await dlq.list())[0]?.status).toBe("resolved");
  });

  it("a thread that breaks mid-way keeps the posted part, dead-letters the rest with the reply anchor, and replays in-thread", async () => {
    const clock = new FakeClock();
    let fail = true;
    const ok = tweetsOk(10);
    const fetch = mockFetch((call, i) => {
      const b = call.body as { text?: string } | undefined;
      if (fail && b?.text === "two") return { status: 500, text: "oops" };
      return ok(call, i);
    });
    const { client, dlq } = buildClient({ fetch, clock, maxAttempts: 2 });
    const err = (await client.thread({ posts: [{ text: "one" }, { text: "two" }, { text: "three" }] }).catch((e: unknown) => e)) as XThreadFailed;
    expect(err).toBeInstanceOf(XThreadFailed);
    expect(err.posted.map((p) => p.id)).toEqual(["10"]);
    expect(err.failedIndex).toBe(1);
    expect(err.dlqId).toBeDefined();

    const entry = (await dlq.get(err.dlqId!))!;
    expect(entry).toMatchObject({ op: "thread", input: { posts: [{ text: "two" }, { text: "three" }], replyTo: "10" } });

    fail = false;
    const r = await dlq.retry(entry.id);
    expect(r.ok).toBe(true);
    const posted = r.entry.result as { id: string }[];
    expect(posted.map((p) => p.id)).toEqual(["11", "12"]);
    const bodies = fetch.calls.filter((c) => c.method === "POST").map((c) => c.body as { text: string; reply?: { in_reply_to_tweet_id: string } });
    const replay = bodies.slice(-2);
    expect(replay[0]).toEqual({ text: "two", reply: { in_reply_to_tweet_id: "10" } });
    expect(replay[1]).toEqual({ text: "three", reply: { in_reply_to_tweet_id: "11" } });
  });
});
