"use client";

import Link from "next/link";
import type { PublicMovieSpecial } from "@cinema/shared";

export function MovieSpecials({ specials, compact = false }: { specials: PublicMovieSpecial[]; compact?: boolean }) {
  if (!specials.length) return null;

  return <section className={compact ? "movie-specials movie-specials--showtimes" : "movie-specials"}>
    {!compact && <><span className="eyebrow">ONLY AT THIS SHOW</span><h2>Movie Specials</h2></>}
    <div className="specials-grid">{specials.map((special) => <article key={special.movieId}>
      {!compact && special.posterUrl && <img src={special.posterUrl} alt="" />}
      <div>
        {compact && <span className="eyebrow">MOVIE SPECIAL</span>}
        <h3>{compact ? "Featured food & drink" : special.movieTitle}</h3>
        {special.items.map((item) => <div className="special-line" key={item.id}><span><strong>{item.name}</strong>{item.description && <small>{item.description}</small>}</span><b>${(item.priceCents / 100).toFixed(2)}</b></div>)}
        {!compact && <Link href={`/movie/${special.movieId}`}>View movie</Link>}
      </div>
    </article>)}</div>
  </section>;
}
