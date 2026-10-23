import { z } from "zod";
import { resetPassword } from "@/lib/password-reset";
import { clientIp, getSession } from "@/lib/session";
import { body, route } from "@/lib/http";

const Input = z.object({
  token: z.string().min(20).max(100),
  password: z.string().min(10).max(200),
});

export const POST = route(
  async (req: Request) => {
    const input = await body(req, Input);
    const { userId, sessionVersion } = await resetPassword(input.token, input.password, await clientIp());
    // Sign in here with the new session version; every older session is now invalid.
    const session = await getSession();
    session.userId = userId;
    session.v = sessionVersion;
    await session.save();
    return { ok: true };
  },
  { mutating: true },
);
