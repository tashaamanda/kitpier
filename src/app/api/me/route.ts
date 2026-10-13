import { pool } from "@/lib/db";
import { route } from "@/lib/http";
import { postedBalance, spendable } from "@/lib/ledger";
import { requireUser } from "@/lib/session";

export const GET = route(async () => {
  const user = await requireUser();
  return {
    user,
    balanceMicros: await postedBalance(pool, user.id),
    spendableMicros: await spendable(pool, user.id),
  };
});
