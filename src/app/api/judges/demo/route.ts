import { one, pool } from "@/lib/db";
import { demoResumeLink, refuseOwnAccount, rotateDemoLink, startDemo } from "@/lib/demo-account";
import { noStore, route } from "@/lib/http";
import { clientIp, currentUser, getSession, requireUser } from "@/lib/session";

// One click from /judges: sign this browser into its own demo account and return its project.
// Pressing it again in the same browser reopens that demo instead of creating another.
export const POST = route(
  async () => {
    const user = await currentUser();
    refuseOwnAccount(user);
    if (user) {
      const p = await one<{ id: string }>(pool, "SELECT id FROM projects WHERE user_id = $1 ORDER BY created_at LIMIT 1", [user.id]);
      if (p) return { projectId: p.id };
    }
    const demo = await startDemo(await clientIp());
    const session = await getSession();
    session.userId = demo.userId;
    session.v = 0;
    await session.save();
    return { projectId: demo.projectId };
  },
  { mutating: true },
);

// The signed-in demo account's private resume link. It signs in like a password, so it's never cached.
export const GET = route(async () => noStore(await demoResumeLink((await requireUser()).id)));

// "Make a new link": every earlier link stops working and every other browser signed in to this demo is signed out.
// This browser stays signed in under the new version.
export const PUT = route(
  async () => {
    const user = await requireUser();
    const version = await rotateDemoLink(user.id);
    const session = await getSession();
    session.v = version;
    await session.save();
    return noStore(await demoResumeLink(user.id));
  },
  { mutating: true },
);
