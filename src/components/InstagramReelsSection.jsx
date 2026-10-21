import React from "react";
import ReelsCarousel from "./ReelsCarousel";
import reelsData from "../data/reelsData";
import "./InstagramReelsSection.css";

const InstagramReelsSection = () => {
  return (
    <section
      className="reels-section"
      aria-labelledby="instagram-reels-heading"
    >
      <div className="reels-header-wrapper">
        <div className="reels-header">
          <span className="reels-eyebrow">A LITTLE JEWELLERY INSPIRATION</span>
          <h2 id="instagram-reels-heading">
            Tanishka <span>In The Spotlight</span>
          </h2>
          <p>Real styles. Real moments. Discover the looks everyone loves.</p>
          <span className="reels-heading-ornament" aria-hidden="true">
            <span />
            <i>✦</i>
            <span />
          </span>
        </div>
      </div>

      <ReelsCarousel reels={reelsData} />
    </section>
  );
};

export default InstagramReelsSection;
