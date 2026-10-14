import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import BookingChat from "@/components/BookingChat";
import { getWidget } from "@/lib/booking";

export const metadata: Metadata = { title: "Book an appointment" };

async function Page({ params }: { params: Promise<{ widgetId: string }> }) {
  await connection();
  const w = await getWidget((await params).widgetId);
  if (!w) notFound();
  // Public view: business name and services only. The owner and project stay server-side.
  return <BookingChat widgetId={w.id} business={w.business_name} services={w.services} />;
}

export default function BookingPage({ params }: PageProps<"/r/[widgetId]">) {
  return (
    <Suspense fallback={<main className="p-10 text-muted">Loading…</main>}>
      <Page params={params} />
    </Suspense>
  );
}
