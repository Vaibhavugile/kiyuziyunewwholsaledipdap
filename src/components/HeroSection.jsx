import React, { useEffect, useState } from "react";
import "./HeroSection.css";

import heroBannerOne from "../assets/hero/Everything Wholesale Marketplace Banner.png";
import heroBannerTwo from "../assets/hero/Global Wholesale Marketplace Banner.png";

const banners = [
  {
    src: heroBannerOne,
    alt: "Everything Wholesale Market — global wholesale marketplace and bulk-buying savings",
  },
  {
    src: heroBannerTwo,
    alt: "Everything Wholesale Market — product categories, wholesale deals and savings up to 90 percent",
  },
];

const SLIDE_INTERVAL = 5500;

export default function HeroSection() {
  const [activeIndex, setActiveIndex] = useState(1);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return undefined;

    const timer = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % banners.length);
    }, SLIDE_INTERVAL);

    return () => window.clearInterval(timer);
  }, [paused]);

  return (
    <section
      className="hcr-section"
      aria-label="Everything Wholesale Market banners"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false);
      }}
    >
      <div className="hcr-banner-shell">
        <div className="hcr-banner-stage">
          {banners.map((banner, index) => (
            <img
              key={banner.src}
              className={`hcr-banner-image${index === activeIndex ? " is-active" : ""}`}
              src={banner.src}
              alt={banner.alt}
              fetchPriority={index === 1 ? "high" : "auto"}
              loading={index === 1 ? "eager" : "lazy"}
              decoding="async"
              draggable="false"
            />
          ))}
        </div>

        <div className="hcr-banner-shine" aria-hidden="true" />

        <div className="hcr-banner-controls" aria-label="Choose banner">
          {banners.map((banner, index) => (
            <button
              key={banner.src}
              type="button"
              className={`hcr-banner-dot${index === activeIndex ? " is-active" : ""}`}
              onClick={() => setActiveIndex(index)}
              aria-label={`Show banner ${index + 1}`}
              aria-pressed={index === activeIndex}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
