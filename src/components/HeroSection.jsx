import React from "react";
import { Link } from "react-router-dom";
import {
  FiArrowRight,
  FiShield,
  FiTruck,
  FiAward,
} from "react-icons/fi";
import "./HeroSection.css";

// Place HeroDesk.webp inside: src/assets/hero/HeroDesk.webp
import heroDesk from "../assets/hero/H25.webp";

const trustItems = [
  { icon: FiAward, title: "Curated Designs", caption: "Styles your customers love" },
  { icon: FiShield, title: "Quality Finishing", caption: "Made for everyday elegance" },
  { icon: FiTruck, title: "Wholesale Orders", caption: "Delivering across India" },
];

export default function HeroSection() {
  return (
    <section className="hcr-section" aria-label="Tanishka wholesale jewellery">
      <div
        className="hcr-hero"
        style={{ "--hcr-hero-image": `url("${heroDesk}")` }}
      >
        <div className="hcr-overlay" aria-hidden="true" />

        <div className="hcr-content">
          <p className="hcr-tagline">Premium Wholesale Jewellery</p>

          <h1 className="hcr-title">
            Elegance That
            <br />
            <span>Elevates Every</span>
            <br />
            Collection
          </h1>

          <p className="hcr-desc">
            Discover exquisite anti-tarnish imitation jewellery for boutiques,
            retailers and resellers. Beautiful designs, refined finishes and
            wholesale service you can trust.
          </p>

          <div className="hcr-actions">
            <Link to="/collections" className="hcr-btn hcr-btn-primary">
              Explore Collections <FiArrowRight aria-hidden="true" />
            </Link>
            <Link to="/contact" className="hcr-btn hcr-btn-secondary">
              Wholesale Enquiry
            </Link>
          </div>

          <div className="hcr-trust-row" aria-label="Wholesale benefits">
            {trustItems.map(({ icon: Icon, title, caption }) => (
              <div className="hcr-trust-item" key={title}>
                <Icon aria-hidden="true" />
                <span>
                  <strong>{title}</strong>
                  <small>{caption}</small>
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="hcr-bottom-note">
          <span className="hcr-note-line" />
          <span>Timeless style. Wholesale value.</span>
        </div>
      </div>
    </section>
  );
}
