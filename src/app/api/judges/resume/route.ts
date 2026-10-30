import { z } from "zod";
import { refuseOwnAccount, resumeDemo } from "@/lib/demo-account";
import { body, rateLimit, route } from "@/lib/http";
import { clientIp, currentUser, getSession } from "@/lib/session";

const Input = z.object({ key: z.string().min(1).max(200) });

// The private resume link (/judges/resume#key) posts its key here to sign this browser back into that demo.
export const POST = route(
  async (req: Request) => {
    const { key } = await body(req, Input);
    await rateLimit(`demo-resume:${await clientIp()}`, 20, 60 * 60_000);
    refuseOwnAccount(await currentUser());
    const demo = await resumeDemo(key);
    const session = await getSession();
    session.userId = demo.userId;
    session.v = demo.version;
    await session.save();
    return { projectId: demo.projectId };
  },
  { mutating: true },
);
