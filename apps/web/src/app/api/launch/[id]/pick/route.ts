import { handlers, type Ctx } from "@/server/routes";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const POST = (req: Request, ctx: Ctx) => handlers.pick(req, ctx.params);
