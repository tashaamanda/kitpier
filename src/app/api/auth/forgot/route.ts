import { z } from "zod";
import { requestPasswordReset } from "@/lib/password-reset";
import { clientIp } from "@/lib/session";
import { body, route } from "@/lib/http";

const Input = z.object({ email: z.string().trim().toLowerCase().email().max(200) });

// Same reply whether or not the account exists; the email goes out after the response.
export const POST = route(
  async (req: Request) => {
    const { email } = await body(req, Input);
    await requestPasswordReset(email, await clientIp());
    return { ok: true };
  },
  { mutating: true },
);
