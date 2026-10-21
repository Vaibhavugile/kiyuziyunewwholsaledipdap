import React from "react";
import "./WholesaleBusinessSection.css";

const DEFAULT_JEWELLERY_IMAGE =
  "https://images.unsplash.com/photo-1611652022419-a9419f74343d?auto=format&fit=crop&w=1400&q=85";

const benefits = [
  { icon: "box", label: "Minimum Order Quantity" },
  { icon: "tag", label: "Competitive Wholesale Prices" },
  { icon: "gem", label: "Wide Range of Designs" },
  { icon: "sparkles", label: "Custom Requirements" },
];

function BenefitIcon({ type }) {
  const common = {
    width: 24, height: 24, viewBox: "0 0 24 24", fill: "none",
    stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round",
    strokeLinejoin: "round", "aria-hidden": true,
  };

  if (type === "box") return <svg {...common}><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="m4.3 7.6 7.7 4.5 7.7-4.5M12 12.1V21M8 5.3l8 4.6" /></svg>;
  if (type === "tag") return <svg {...common}><path d="M20.5 13.5 13 21l-10-10V3h8l9.5 10.5Z" /><circle cx="7.5" cy="7.5" r="1.2" /><path d="m11 10 5 5" /></svg>;
  if (type === "gem") return <svg {...common}><path d="M6 3h12l4 6-10 12L2 9l4-6Z" /><path d="M2 9h20M6 3l3 6 3 12 3-12 3-6M9 9l3-6 3 6" /></svg>;
  return <svg {...common}><path d="m12 2 1.7 6.3L20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7L12 2Z" /><path d="m19 15 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15ZM5 14l.7 1.8L7.5 16.5l-1.8.7L5 19l-.7-1.8-1.8-.7 1.8-.7L5 14Z" /></svg>;
}

export default function WholesaleBusinessSection({
  image = DEFAULT_JEWELLERY_IMAGE,
  onQuoteClick,
  quoteHref = "/contact",
}) {
  const handleQuoteClick = (event) => {
    if (onQuoteClick) {
      event.preventDefault();
      onQuoteClick();
    }
  };

  return (
    <section className="wholesale-business" aria-labelledby="wholesale-business-title">
      <div className="wholesale-business__inner">
        <div className="wholesale-business__image-wrap">
          <img
            className="wholesale-business__image"
            src={image}
            alt="Gold-tone Indian jewellery arranged on rich burgundy fabric"
            loading="lazy"
          />
          <div className="wholesale-business__image-shade" />
          <span className="wholesale-business__image-caption">
            A beautiful collection for every business
          </span>
        </div>

        <div className="wholesale-business__content">
          <span className="wholesale-business__eyebrow">YOUR WHOLESALE PARTNER</span>
          <h2 id="wholesale-business-title">
            Wholesale Jewellery
            <span>For Growing Businesses</span>
          </h2>
          <p className="wholesale-business__description">
            Discover beautiful designs and business-friendly wholesale options
            to help your jewellery business grow.
          </p>

          <ul className="wholesale-business__benefits">
            {benefits.map((benefit) => (
              <li key={benefit.label}>
                <span className="wholesale-business__icon"><BenefitIcon type={benefit.icon} /></span>
                <span>{benefit.label}</span>
              </li>
            ))}
          </ul>

          <a className="wholesale-business__cta" href={quoteHref} onClick={handleQuoteClick}>
            <span>Get Wholesale Quote</span>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14M13 5l7 7-7 7" />
            </svg>
          </a>
          <p className="wholesale-business__note">
            For retailers, resellers, boutiques and growing brands
          </p>
        </div>
      </div>
    </section>
  );
}
