import { Shell } from "@/components/Shell";
import { StatusScreen } from "@/components/StatusScreen";

export const dynamic = "force-dynamic";

export default function StatusPage() {
  return (
    <Shell current="/status">
      <StatusScreen />
    </Shell>
  );
}
