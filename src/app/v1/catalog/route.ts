import { searchCatalog } from "@/lib/stack";
import { route } from "@/lib/http";

// Public: what Kitpier offers and how each is paid for. Prices come from the server's price card.
export const GET = route(async (req: Request) => {
  const q = new URL(req.url).searchParams;
  return { listings: searchCatalog({ category: q.get("category") ?? undefined, query: q.get("q")?.slice(0, 100) ?? undefined }) };
});
