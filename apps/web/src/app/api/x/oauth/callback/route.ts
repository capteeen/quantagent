import { handlers } from "@/server/routes";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const GET = (req: Request) => handlers.oauthCallback(req);
export const POST = (req: Request) => handlers.oauthCallback(req);
