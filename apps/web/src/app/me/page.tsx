import { MeScreen } from "@/components/MeScreen";
import { Shell } from "@/components/Shell";

export const dynamic = "force-dynamic";

export default function MePage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const xErrorRaw = searchParams?.["x_error"];
  return (
    <Shell current="/me">
      <MeScreen xError={typeof xErrorRaw === "string" ? xErrorRaw : null} />
    </Shell>
  );
}
