import { handlers } from "@/server/routes";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const GET = () => handlers.status();
