/** The handlers bound to the process singleton; app/api/** route files re-export from here. */
import { makeHandlers } from "./handlers";
import { getService } from "./singleton";

export const handlers = makeHandlers(getService);
export type Ctx = { params: { id: string } };
