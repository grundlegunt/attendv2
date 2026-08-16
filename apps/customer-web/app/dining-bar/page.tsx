"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { PublicMenuItem } from "@cinema/shared";
import { useCinemaContent } from "../components/customer-branding";
import { MovieSpecials } from "../components/movie-specials";
import { usePublicDiningMenu } from "../components/public-dining-menu";

type MenuFilter = "FULL" | "VEGAN" | "GLUTEN_FREE";

function matchesFilter(item: PublicMenuItem, filter: MenuFilter) {
  if (filter === "VEGAN") return item.isVegan;
  if (filter === "GLUTEN_FREE") return item.isGlutenFree;
  return true;
}

function MenuItemCard({ item }: { item: PublicMenuItem }) {
  return <article className={`public-menu-item${item.imageUrl ? " public-menu-item--with-image" : ""}`}>
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
  const { menu, error, retry } = usePublicDiningMenu();
  const [filter, setFilter] = useState<MenuFilter>("FULL");

  const categories = useMemo(() => menu?.categories
    .map((category) => ({ ...category, items: category.items.filter((item) => matchesFilter(item, filter)) }))
    .filter((category) => category.items.length) ?? [], [filter, menu]);

  return <main className="cinema-shell route-page dining-page">
    <section className="route-heading"><span className="eyebrow">{dining.eyebrow}</span><h1>{dining.title}</h1><p>{dining.intro}</p></section>

    <section className="afterglow-callout"><div><span className="eyebrow">{dining.afterglowEyebrow}</span><h2>{dining.afterglowTitle}</h2><p>{dining.afterglowBody}</p><Link className="primary-link" href="/afterglow">{dining.afterglowButton}</Link></div></section>

    <section className="how-it-works dining-how-it-works" aria-labelledby="how-heading">
      <div><span className="eyebrow">{dining.howEyebrow}</span><h2 id="how-heading">{dining.howTitle}</h2></div>
      <ol>{dining.steps.map((step, index) => <li key={step.title}><strong>{String(index + 1).padStart(2, "0")}</strong><h3>{step.title}</h3><p>{step.body}</p></li>)}</ol>
    </section>

    <div className="dining-menu-layout">
      <div className="dining-menu-layout__specials">
        <MovieSpecials specials={menu?.movieSpecials ?? []} />
      </div>

      <section className="public-menu dining-menu-layout__menu" aria-labelledby="menu-heading">
        <div className="section-heading-row"><div><span className="eyebrow">FOOD &amp; DRINK</span><h2 id="menu-heading">The menu</h2></div><div className="menu-filters" role="group" aria-label="Filter menu"><button className={filter === "FULL" ? "active" : ""} onClick={() => setFilter("FULL")}>Full</button><button className={filter === "VEGAN" ? "active" : ""} onClick={() => setFilter("VEGAN")}>Vegan</button><button className={filter === "GLUTEN_FREE" ? "active" : ""} onClick={() => setFilter("GLUTEN_FREE")}>Gluten-Free</button></div></div>
        {error && <><div className="error-banner">{error}</div><button className="primary" type="button" onClick={retry}>Try again</button></>}
        {!menu && !error && <p className="loading-copy">Loading the menu…</p>}
        {menu && categories.length === 0 && <p className="secondary-copy">No menu items match this filter.</p>}
        {menu?.menuPresentation && <div className="published-menu-asset">
          {menu.menuPresentation.assetType === "IMAGE"
            ? <img src={menu.menuPresentation.assetUrl} alt="Current food and drink menu" />
            : <><iframe title="Current food and drink menu" src={menu.menuPresentation.assetUrl} /><a className="primary-link" href={menu.menuPresentation.assetUrl} target="_blank" rel="noreferrer">Open full menu PDF</a></>}
        </div>}
        <details className="accessible-menu" open={!menu?.menuPresentation}>
          <summary>{menu?.menuPresentation ? "Browse accessible text menu" : "Current menu"}</summary>
          <div className="public-menu-sheet">
            {categories.map((category) => (
              <section className="menu-category" key={category.id}>
                <h3>{category.name}</h3>
                <div className="public-menu-grid">
                  {category.items.map((item) => <MenuItemCard item={item} key={item.id} />)}
                </div>
              </section>
            ))}
          </div>
        </details>
      </section>
    </div>

  </main>;
}
