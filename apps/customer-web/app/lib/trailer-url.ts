export function youtubeEmbedUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    let videoId: string | null = null;
    if (host === "youtu.be") videoId = url.pathname.split("/").filter(Boolean)[0] ?? null;
    if (host === "youtube.com" || host === "m.youtube.com") {
      if (url.pathname === "/watch") videoId = url.searchParams.get("v");
      else if (/^\/(embed|shorts)\//.test(url.pathname)) videoId = url.pathname.split("/")[2] ?? null;
    }
    if (!videoId || !/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) return null;
    return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`;
  } catch {
    return null;
  }
}
