"use client";

import Link from "next/link";
import type { PublicMovieSpecial } from "@cinema/shared";

export function MovieSpecials({ specials, showtimes = false }: { specials: PublicMovieSpecial[]; showtimes?: boolean }) {
  if (!specials.length) return null;

  if (showtimes) {
    const publishedSpecials = specials.filter((special) => special.artworkUrl);
    if (!publishedSpecials.length) return null;
    return <section className="movie-specials movie-specials--showtimes">
    <span className="eyebrow">ONLY AT THIS SHOW</span>
    <h2>Dining Specials</h2>
    <Link className="showtime-specials-menu-link" href="/dining-bar">See full menu</Link>
    <div className="showtime-specials-grid">{publishedSpecials.map((special) => {
      return <Link href={`/movie/${special.movieId}`} className="showtime-special-card" key={special.movieId}>
        <img className="showtime-special-card__artwork" src={special.artworkUrl!} alt="" />
        <div className="showtime-special-card__copy"><strong>{special.headline || special.items.map((item) => item.name).join(" & ")}</strong><span>{special.movieTitle}</span></div>
      </Link>;
    })}</div>
  </section>;
  }

  return <section className="movie-specials">
    <span className="eyebrow">ONLY AT THIS SHOW</span><h2>Movie Specials</h2>
    <div className="specials-grid">{specials.map((special) => <article className="dining-special" key={special.movieId}>
      <div className="dining-special__heading">
        <span className="eyebrow">FEATURED WITH</span>
        <h3>{special.movieTitle}</h3>
        <Link href={`/movie/${special.movieId}`}>View movie</Link>
      </div>
      <div className="dining-special__items">
        {special.items.map((item) => <div className="dining-special-item" key={item.id}>
          {item.imageUrl && <img src={item.imageUrl} alt={item.name} />}
          <div className="special-line"><span><strong>{item.name}</strong>{item.description && <small>{item.description}</small>}</span></div>
        </div>)}
      </div>
    </article>)}</div>
  </section>;
}
