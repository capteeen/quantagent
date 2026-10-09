import { cookies } from "next/headers";
import { EmptyState } from "@/components/ui";
import { LaunchScreen } from "@/components/LaunchScreen";
import { Shell } from "@/components/Shell";
import { SESSION_COOKIE, verifySession } from "@/server/session";
import { getService } from "@/server/singleton";

export const dynamic = "force-dynamic";

export default async function LaunchPage({ params }: { params: { id: string } }) {
  const svc = await getService();
  const accountId = verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (!svc.has(params.id)) {
    return (
      <Shell current="/">
        <EmptyState failed title={`No launch ${params.id} in this process.`} detail="Launches live in the orchestrator process that started them; this one is not here (restarted, or a different instance)." />
      </Shell>
    );
  }
  return (
    <Shell current="/">
      <LaunchScreen launchId={params.id} accountId={accountId} logOpen />
    </Shell>
  );
}
