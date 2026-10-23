import bcrypt from "bcryptjs";
import { z } from "zod";
import { one, pool } from "@/lib/db";
import { HttpError, clientIp, getSession } from "@/lib/session";
import { body, rateLimit, route } from "@/lib/http";

const Input = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
});

// Compared against when the email doesn't exist, so timing doesn't reveal accounts.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 12);

export const POST = route(
  async (req: Request) => {
    const input = await body(req, Input);
    await rateLimit(`login:${await clientIp()}`, 20, 15 * 60_000);
    await rateLimit(`login:${input.email}`, 8, 15 * 60_000);
    const user = await one<{ id: string; password_hash: string; session_version: number }>(
      pool,
      "SELECT id, password_hash, session_version FROM users WHERE email = $1",
      [input.email],
    );
    const ok = await bcrypt.compare(input.password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !ok) throw new HttpError(401, "Wrong email or password");
    const session = await getSession();
    session.userId = user.id;
    session.v = user.session_version;
    await session.save();
    return { ok: true };
  },
  { mutating: true },
);
