import { handlers } from "@/server/routes";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const POST = (req: Request) => handlers.xDisconnect(req);
