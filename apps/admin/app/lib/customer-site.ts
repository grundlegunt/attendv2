export const CUSTOMER_WEB_URL = (process.env.NEXT_PUBLIC_CUSTOMER_WEB_URL
  ?? (process.env.NODE_ENV === "production" ? "https://attendv2-attend3.vercel.app" : "http://localhost:3000"))
  .replace(/\/$/, "");
