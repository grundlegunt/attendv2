import { redirect } from "next/navigation";

type HomePageProps = {
  searchParams: Promise<{ locationId?: string | string[] }>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const requestedLocationId = (await searchParams).locationId;
  const locationId = Array.isArray(requestedLocationId) ? requestedLocationId[0] : requestedLocationId;

  redirect(locationId ? `/showtimes?locationId=${encodeURIComponent(locationId)}` : "/showtimes");
}
