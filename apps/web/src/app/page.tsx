import { cookies } from "next/headers";
import { LaunchScreen } from "@/components/LaunchScreen";
import { Shell } from "@/components/Shell";
import { SESSION_COOKIE, verifySession } from "@/server/session";

export const dynamic = "force-dynamic";

export default function Home({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const accountId = verifySession(cookies().get(SESSION_COOKIE)?.value);
  const xErrorRaw = searchParams?.["x_error"];
  const xError = typeof xErrorRaw === "string" ? xErrorRaw : null;
  return (
    <Shell current="/">
      <LaunchScreen launchId={null} accountId={accountId} xError={xError} />
    </Shell>
  );
}
