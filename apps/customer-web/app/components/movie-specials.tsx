"use client";

import Link from "next/link";
import type { PublicMovieSpecial } from "@cinema/shared";

export function MovieSpecials({ specials, showtimes = false }: { specials: PublicMovieSpecial[]; showtimes?: boolean }) {
  if (!specials.length) return null;

  if (showtimes) return <section className="movie-specials movie-specials--showtimes">
    <span className="eyebrow">ONLY AT THIS SHOW</span>
    <h2>Dining Specials</h2>
    <div className="showtime-specials-grid">{specials.flatMap((special) => special.items.map((item) => <Link href={`/movie/${special.movieId}`} className="showtime-special-card" key={`${special.movieId}-${item.id}`}>
      {item.imageUrl ? <img src={item.imageUrl} alt="" /> : <div className="showtime-special-card__placeholder" aria-hidden="true" />}
      <div><strong>{item.name}</strong><span>{special.movieTitle}</span></div>
    </Link>))}</div>
  </section>;

  return <section className="movie-specials">
    <span className="eyebrow">ONLY AT THIS SHOW</span><h2>Movie Specials</h2>
    <div className="specials-grid">{specials.map((special) => <article key={special.movieId}>
      {special.posterUrl && <img src={special.posterUrl} alt="" />}
      <div>
        <h3>{special.movieTitle}</h3>
        {special.items.map((item) => <div className="special-line" key={item.id}><span><strong>{item.name}</strong>{item.description && <small>{item.description}</small>}</span><b>${(item.priceCents / 100).toFixed(2)}</b></div>)}
        <Link href={`/movie/${special.movieId}`}>View movie</Link>
      </div>
    </article>)}</div>
  </section>;
}
