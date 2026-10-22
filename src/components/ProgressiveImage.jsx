
import React from "react";

export default function ProgressiveImage({
  src,
  alt = "",
  className = "",
  loading = "lazy",
}) {
  if (!src) {
    return (
      <div
        className={`progressive-img ${className}`}
        aria-label="Image unavailable"
      />
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={`progressive-img ${className}`}
      loading={loading}
      decoding="async"
      fetchPriority={loading === "eager" ? "high" : "auto"}
    />
  );
}
