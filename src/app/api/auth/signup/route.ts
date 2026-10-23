import bcrypt from "bcryptjs";
import { z } from "zod";
import { newId, pool } from "@/lib/db";
import { HttpError, clientIp, getSession } from "@/lib/session";
import { body, rateLimit, route } from "@/lib/http";

const Input = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  name: z.string().trim().min(1).max(60),
  password: z.string().min(10).max(200),
});

export const POST = route(
  async (req: Request) => {
    await rateLimit(`signup:${await clientIp()}`, 10, 60 * 60_000);
    const input = await body(req, Input);
    const id = newId("usr");
    const r = await pool.query(
      "INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO NOTHING",
      [id, input.email, input.name, await bcrypt.hash(input.password, 12)],
    );
    if (r.rowCount === 0) throw new HttpError(409, "An account with that email already exists");
    const session = await getSession();
    session.userId = id;
    session.v = 0;
    await session.save();
    return { ok: true };
  },
  { mutating: true },
);
