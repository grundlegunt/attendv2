"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { youtubeEmbedUrl } from "../lib/trailer-url";

export function TrailerTrigger({ url, title, className, children = "Watch trailer" }: { url: string; title: string; className?: string; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const embedUrl = youtubeEmbedUrl(url);

  useEffect(() => {
    if (!open) return;
    function closeOnEscape(event: KeyboardEvent) { if (event.key === "Escape") setOpen(false); }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  if (!embedUrl) return <a className={className} href={url} target="_blank" rel="noreferrer">{children} <span aria-hidden="true">↗</span></a>;

  return <>
    <button className={className} type="button" onClick={() => setOpen(true)}>{children}</button>
    {open && createPortal(<div className="trailer-modal" role="dialog" aria-modal="true" aria-label={`${title} trailer`} onMouseDown={() => setOpen(false)}>
      <div className="trailer-modal__content" onMouseDown={(event) => event.stopPropagation()}>
        <header><strong>{title} trailer</strong><button type="button" onClick={() => setOpen(false)} aria-label="Close trailer">×</button></header>
        <iframe src={embedUrl} title={`${title} trailer`} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />
      </div>
    </div>, document.body)}
  </>;
}
