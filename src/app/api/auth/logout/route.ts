import { getSession } from "@/lib/session";
import { route } from "@/lib/http";

export const POST = route(
  async () => {
    (await getSession()).destroy();
    return { ok: true };
  },
  { mutating: true },
);
