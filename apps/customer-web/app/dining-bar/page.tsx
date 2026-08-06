"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { PublicDiningMenuResponse, PublicMenuItem } from "@cinema/shared";
import { apiFetch, ApiRequestError } from "../lib/api-client";
import { useCinemaContent } from "../components/customer-branding";

type MenuFilter = "FULL" | "VEGAN" | "GLUTEN_FREE";

function matchesFilter(item: PublicMenuItem, filter: MenuFilter) {
  if (filter === "VEGAN") return item.isVegan;
  if (filter === "GLUTEN_FREE") return item.isGlutenFree;
  return true;
}

function MenuItemCard({ item }: { item: PublicMenuItem }) {
  return <article className="public-menu-item">
    {item.imageUrl && <img src={item.imageUrl} alt="" />}
    <div>
      <div className="public-menu-item__heading"><h3>{item.name}</h3><strong>${(item.priceCents / 100).toFixed(2)}</strong></div>
      {item.description && <p>{item.description}</p>}
      <div className="dietary-badges">{item.isVegan && <span>Vegan</span>}{item.isGlutenFree && <span>Gluten-free</span>}</div>
    </div>
  </article>;
}

export default function DiningBarPage() {
  const { dining } = useCinemaContent();
  const [menu, setMenu] = useState<PublicDiningMenuResponse | null>(null);
  const [filter, setFilter] = useState<MenuFilter>("FULL");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<PublicDiningMenuResponse>("/cinema/menu")
      .then(setMenu)
      .catch((reason) => setError(reason instanceof ApiRequestError ? reason.body.message : "The menu is unavailable."));
  }, []);

  const categories = useMemo(() => menu?.categories
    .map((category) => ({ ...category, items: category.items.filter((item) => matchesFilter(item, filter)) }))
    .filter((category) => category.items.length) ?? [], [filter, menu]);

  return <main className="cinema-shell route-page dining-page">
    <section className="route-heading"><span className="eyebrow">{dining.eyebrow}</span><h1>{dining.title}</h1><p>{dining.intro}</p></section>

    <section className="how-it-works" aria-labelledby="how-heading">
      <div><span className="eyebrow">{dining.howEyebrow}</span><h2 id="how-heading">{dining.howTitle}</h2></div>
      <ol>{dining.steps.map((step, index) => <li key={step.title}><strong>{String(index + 1).padStart(2, "0")}</strong><h3>{step.title}</h3><p>{step.body}</p></li>)}</ol>
    </section>

    <section className="public-menu" aria-labelledby="menu-heading">
      <div className="section-heading-row"><div><span className="eyebrow">FOOD &amp; DRINK</span><h2 id="menu-heading">The menu</h2></div><div className="menu-filters" role="group" aria-label="Filter menu"><button className={filter === "FULL" ? "active" : ""} onClick={() => setFilter("FULL")}>Full</button><button className={filter === "VEGAN" ? "active" : ""} onClick={() => setFilter("VEGAN")}>Vegan</button><button className={filter === "GLUTEN_FREE" ? "active" : ""} onClick={() => setFilter("GLUTEN_FREE")}>Gluten-Free</button></div></div>
      {error && <div className="error-banner">{error}</div>}
      {!menu && !error && <p className="loading-copy">Loading the menu…</p>}
      {menu && categories.length === 0 && <p className="secondary-copy">No menu items match this filter.</p>}
      {categories.map((category) => <section className="menu-category" key={category.id}><h3>{category.name}</h3><div className="public-menu-grid">{category.items.map((item) => <MenuItemCard item={item} key={item.id} />)}</div></section>)}
    </section>

    {menu?.movieSpecials.length ? <section className="movie-specials"><span className="eyebrow">ONLY AT THIS SHOW</span><h2>Movie Specials</h2><div className="specials-grid">{menu.movieSpecials.map((special) => <article key={special.movieId}>{special.posterUrl && <img src={special.posterUrl} alt="" />}<div><h3>{special.movieTitle}</h3>{special.items.map((item) => <div className="special-line" key={item.id}><span><strong>{item.name}</strong>{item.description && <small>{item.description}</small>}</span><b>${(item.priceCents / 100).toFixed(2)}</b></div>)}<Link href={`/movie/${special.movieId}`}>View movie</Link></div></article>)}</div></section> : null}

    <section className="afterglow-callout"><div><span className="eyebrow">{dining.afterglowEyebrow}</span><h2>{dining.afterglowTitle}</h2><p>{dining.afterglowBody}</p><Link className="primary-link" href="/afterglow">{dining.afterglowButton}</Link></div></section>
  </main>;
}
