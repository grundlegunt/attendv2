import { proxyCustomerApiRequest } from "../../../../lib/customer-api-proxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return proxyCustomerApiRequest(request, ["cinema", "now-playing"]);
}
