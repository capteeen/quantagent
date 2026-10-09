import { EmptyState } from "@/components/ui";
import { CoinScreen } from "@/components/CoinScreen";
import { Shell } from "@/components/Shell";
import { getService } from "@/server/singleton";

export const dynamic = "force-dynamic";

export default async function CoinPage({ params }: { params: { ca: string } }) {
  const svc = await getService();
  const launchId = svc.findByCa(params.ca);
  if (!launchId) {
    return (
      <Shell current="/">
        <EmptyState failed title="No launch in this process deployed this contract address." detail={`${params.ca} — only coins launched by this orchestrator process have a page here. Nothing is shown for an address it did not deploy.`} />
      </Shell>
    );
  }
  return (
    <Shell current="/">
      <CoinScreen launchId={launchId} ca={params.ca} />
    </Shell>
  );
}
