import { handlers, type Ctx } from "@/server/routes";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const GET = (req: Request, ctx: Ctx) => handlers.events(req, ctx.params);
