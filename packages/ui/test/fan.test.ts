import { describe, expect, it } from "vitest";
import type { Candidate, QuantagentEvent } from "@quantagent/core/types";
import { fanGhosts, FAN_SPLIT_T } from "../src/chamber/collapse/fan";
import { COLLAPSE } from "../src/chamber/collapse/timeline";
import { anchorPosition, strandCurve } from "../src/chamber/layout";
import recorded from "../src/fixtures/launch.recorded.json";

const events = recorded as QuantagentEvent[];

describe("the fan (SPEC §6.4): N ghost tubes, radius 0.012, opacity 0.35, spreading near the anchor", () => {
  it("makes one ghost per candidate, each ending in a bead near the anchor, deterministically", () => {
    const artist = events.find((e) => e.type === "Worker.candidates" && e.worker === "Artist");
    if (!artist || artist.type !== "Worker.candidates") throw new Error("fixture has no Artist candidates");
    const cands: Candidate[] = artist.payload.candidates;
    expect(cands).toHaveLength(12);
    const ghosts = fanGhosts("Artist", cands);
    expect(ghosts).toHaveLength(12);
    expect(COLLAPSE.ghostRadius).toBe(0.012);
    expect(COLLAPSE.ghostOpacity).toBe(0.35);
    expect(COLLAPSE.fanMs).toBe(600);
    const anchor = anchorPosition(1);
    const split = strandCurve("Artist").getPointAt(FAN_SPLIT_T);
    for (const g of ghosts) {
      expect(g.curve.getPoint(0).distanceTo(split)).toBeLessThan(1e-6);
      expect(g.bead.distanceTo(anchor)).toBeGreaterThan(0.2);
      expect(g.bead.distanceTo(anchor)).toBeLessThan(0.9);
      expect(g.candidate.thumbnailUrl).toMatch(/_48\.png$/);
    }
    // every bead is distinct and the layout is reproducible
    const beads = new Set(ghosts.map((g) => g.bead.toArray().map((v) => v.toFixed(5)).join(",")));
    expect(beads.size).toBe(12);
    const again = fanGhosts("Artist", cands);
    expect(again.map((g) => g.bead.toArray())).toEqual(ghosts.map((g) => g.bead.toArray()));
  });

  it("a single candidate still fans (one ghost straight up from the split)", () => {
    const ghosts = fanGhosts("Voice", [{ id: "only", value: "x", reason: "only one" }]);
    expect(ghosts).toHaveLength(1);
  });
});
