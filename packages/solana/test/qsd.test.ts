import { describe, expect, it } from "vitest";
import { NotImplemented } from "@quantagent/core/types";
import { createSolanaClient } from "../src/client";
import { loadQsd, qsdLaunch, QSD_PACKAGES, registerWithQsd } from "../src/qsd/index";
import { baseEnv, mockRpc } from "./helpers";

const handlers = { onStage() {}, onChainStep() {}, onTreeLevelFused() {}, onSignChainStop() {} };
const identity = { name: "Q", ticker: "Q", lore: "", hook: "", trend: "" };

describe("QSD boundary", () => {
  it("tries to import exactly @qsd/crypto, @qsd/quantum, @qsd/protocol", async () => {
    const asked: string[] = [];
    await expect(
      loadQsd(async (n) => {
        asked.push(n);
        throw Object.assign(new Error(`Cannot find package '${n}'`), { code: "ERR_MODULE_NOT_FOUND" });
      }),
    ).rejects.toBeInstanceOf(NotImplemented);
    expect(asked).toEqual(["@qsd/crypto"]);
    expect(QSD_PACKAGES).toEqual(["@qsd/crypto", "@qsd/quantum", "@qsd/protocol"]);
  });

  it("with qsd-market unlinked, loadQsd / qsdLaunch / registerWithQsd throw NotImplemented('QSD protocol')", async () => {
    const err = await loadQsd().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotImplemented);
    expect((err as NotImplemented).capability).toBe("QSD protocol");
    expect((err as NotImplemented).because).toBe("qsd-market is not linked in this workspace");
    await expect(qsdLaunch({ identity, logoUrl: "https://x/l.png" }, handlers, { cluster: "devnet" })).rejects.toBeInstanceOf(NotImplemented);
    await expect(registerWithQsd({ coinCa: "x", identityRoot: "y" }, { cluster: "devnet" })).rejects.toBeInstanceOf(NotImplemented);
  });

  it("the SolanaClient surfaces the same NotImplemented", async () => {
    const c = await createSolanaClient({ launchId: "L", budgetSol: 1, env: baseEnv(), rpc: mockRpc() });
    await expect(c.qsdLaunch({ identity, logoUrl: "https://x/l.png" }, handlers)).rejects.toBeInstanceOf(NotImplemented);
    await expect(c.registerWithQsd({ coinCa: "x", identityRoot: "y" })).rejects.toBeInstanceOf(NotImplemented);
  });

  it("an unrelated import failure is not masked as 'unlinked'", async () => {
    await expect(loadQsd(async () => { throw new Error("syntax error in package"); })).rejects.toThrow("syntax error in package");
  });
});
