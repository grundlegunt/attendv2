import type { Metadata } from "next";
import { MobileTicket } from "./mobile-ticket";

export const metadata: Metadata = {
  title: "Mobile tickets",
  robots: { index: false, follow: false },
};

export default async function MobileTicketPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  return (
    <main className="cinema-shell route-page mobile-ticket-page">
      <MobileTicket orderId={orderId} />
    </main>
  );
}
