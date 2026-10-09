/**
 * The eight strands. Lazy-mounted behind the vessel and core (SPEC §6.7: first frame under
 * 2s, strands stream in behind). Strand count is never degraded.
 */
import { WORKER_NAMES } from "@quantagent/core/types";
import { Strand } from "./Strand";

export default function StrandField() {
  return (
    <group name="strands">
      {WORKER_NAMES.map((w) => (
        <Strand key={w} worker={w} />
      ))}
    </group>
  );
}
