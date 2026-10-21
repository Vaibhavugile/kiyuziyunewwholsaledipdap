import React, { useEffect, useMemo, useState } from "react";
import "./CollectionCard.css";

/**
 * Tanishka round category card.
 * Keeps the existing CollectionCard props so it can replace the current component.
 */
const CollectionCard = ({
  id,
  title,
  image,
  additionalImages = [],
  alt,
  onClick,
  children,
}) => {
  const imagesToDisplay = useMemo(
    () => [
      ...(image ? [image] : []),
      ...(Array.isArray(additionalImages)
        ? additionalImages.filter(Boolean)
        : []),
    ],
    [image, additionalImages]
  );

  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  useEffect(() => {
    setCurrentImageIndex(0);
  }, [imagesToDisplay.length, image]);

  useEffect(() => {
    if (imagesToDisplay.length < 2) return undefined;

    const timer = window.setInterval(() => {
      setCurrentImageIndex((current) => (current + 1) % imagesToDisplay.length);
    }, 5000);

    return () => window.clearInterval(timer);
  }, [imagesToDisplay.length]);

  const activateCard = (event) => {
    if (onClick) onClick(event);
  };

  const handleKeyDown = (event) => {
    if (!onClick) return;

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick(event);
    }
  };

  return (
    <article
      className={`collection-card${onClick ? " collection-card-clickable" : ""}`}
      role={onClick ? "button" : "group"}
      aria-labelledby={id ? `collection-title-${id}` : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={activateCard}
      onKeyDown={handleKeyDown}
    >
      {children && (
        <div
          className="collection-admin-actions"
          onClick={(event) => event.stopPropagation()}
        >
          {children}
        </div>
      )}

      <div className="collection-card-inner">
        <div className="collection-circle-wrap">
          <span className="collection-circle-ornament collection-circle-ornament-one" aria-hidden="true" />
          <span className="collection-circle-ornament collection-circle-ornament-two" aria-hidden="true" />

          <div className="collection-circle">
            {imagesToDisplay.length > 0 ? (
              imagesToDisplay.map((src, index) => (
                <img
                  key={`${src}-${index}`}
                  src={src}
                  alt={alt || title || "Jewellery category"}
                  className={`collection-image${index === currentImageIndex ? " active" : ""}`}
                  loading={index === 0 ? "eager" : "lazy"}
                  decoding="async"
                  draggable={false}
                />
              ))
            ) : (
              <div className="collection-image-placeholder" aria-hidden="true" />
            )}
            <span className="collection-circle-shade" aria-hidden="true" />
            <span className="collection-circle-view" aria-hidden="true">
              <span>Explore</span>
              <span className="collection-circle-arrow">↗</span>
            </span>
          </div>

          <span className="collection-circle-sparkle sparkle-top" aria-hidden="true">✦</span>
          <span className="collection-circle-sparkle sparkle-bottom" aria-hidden="true">✧</span>
        </div>

        <div className="collection-card-content">
          <h3
            className="product-pill"
            id={id ? `collection-title-${id}` : undefined}
            title={title}
          >
            {title || "Collection"}
          </h3>
          <span className="collection-card-subtitle">Discover the collection</span>
          <span className="btn-pill" aria-hidden="true">
            Explore collection <span className="arrow">→</span>
          </span>
        </div>
      </div>
    </article>
  );
};

export default CollectionCard;
