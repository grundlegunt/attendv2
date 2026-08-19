const configuredSiteUrl = process.env.NEXT_PUBLIC_CUSTOMER_WEB_URL?.trim();

export const customerSiteUrl = configuredSiteUrl
  ? configuredSiteUrl.replace(/\/+$/, "")
  : "http://localhost:3000";
