import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { db, collection, getDocs } from "../firebase";
import CollectionCard from "../components/CollectionCard";
import HeroSection from "../components/HeroSection";
import "./HomePage.css";
import BulkEnquirySection from "../components/BulkEnquirySection";
import InstagramReelsSection from "../components/InstagramReelsSection";
import { trackMetaEvent } from "../utils/pixels";
import earringImage from "../assets/earing.jpeg";
import WholesaleBusinessSection from "../components/WholesaleBusinessSection";
import HomepageSections from "../components/HomepageSections";
/*
 * Local fallback categories:
 * These are shown only when Firestore's "collections" collection is empty,
 * or if loading Firestore collections fails.
 *
 * Replace the image paths below with your actual category images whenever ready.
 * The files should be placed under: src/assets/categories/
 */
const FALLBACK_COLLECTIONS = [
  {
    id: "necklaces",
    title: "Necklaces",
    image: earringImage,
    imageAlt: "Tanishka necklace collection",
  },
  {
    id: "earrings",
    title: "Earrings",
    image: earringImage,
    imageAlt: "Tanishka earrings collection",
  },
  {
    id: "bangles",
    title: "Bangles",
    image: earringImage,
    imageAlt: "Tanishka bangles collection",
  },
  {
    id: "bridal-sets",
    title: "Bridal Sets",
    image: earringImage,
    imageAlt: "Tanishka bridal jewellery collection",
  },
  {
    id: "rings",
    title: "Rings",
    image: earringImage,
    imageAlt: "Tanishka rings collection",
  },
  {
    id: "mangalsutra",
    title: "Mangalsutra",
    image: earringImage,
    imageAlt: "Tanishka mangalsutra collection",
  },
  {
    id: "chains",
    title: "Chains",
    image: earringImage,
    imageAlt: "Tanishka chains collection",
  },
  {
    id: "new-arrivals",
    title: "New Arrivals",
    image: earringImage,
    imageAlt: "Tanishka new arrivals collection",
  },
];

const HomePage = () => {
  const [collections, setCollections] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [usingFallbackCollections, setUsingFallbackCollections] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const fetchCollections = async () => {
      setIsLoading(true);

      try {
        const qSnap = await getDocs(collection(db, "collections"));
        const fetched = qSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        fetched.sort((a, b) => (a.showNumber || 0) - (b.showNumber || 0));

        if (!isMounted) return;

        if (fetched.length > 0) {
          setCollections(fetched);
          setUsingFallbackCollections(false);
        } else {
          setCollections(FALLBACK_COLLECTIONS);
          setUsingFallbackCollections(true);
        }
      } catch (err) {
        console.error("Error fetching collections:", err);

        // Keep the homepage useful even when Firestore is unavailable.
        if (isMounted) {
          setCollections(FALLBACK_COLLECTIONS);
          setUsingFallbackCollections(true);
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    fetchCollections();

    return () => {
      isMounted = false;
    };
  }, []);

  // Reveal collection links after they enter the viewport.
  useEffect(() => {
    if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") {
      return undefined;
    }

    const nodes = document.querySelectorAll(".collection-link");
    if (!nodes.length) return undefined;

    const io = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("reveal");
            observer.unobserve(entry.target);
          }
        });
      },
      {
        root: null,
        rootMargin: "0px 0px -10% 0px",
        threshold: 0.08,
      }
    );

    nodes.forEach((node) => io.observe(node));
    return () => io.disconnect();
  }, [collections, isLoading]);

  const handleCollectionClick = (col) => {
    trackMetaEvent("ViewContent", {
      content_name: col.title || col.name || "Collection",
      content_ids: [col.id],
      content_type: "product_group",
    });
  };

  return (
    <>
      <HeroSection />

      {/* Dynamic price, festival and sale sections are inserted into the existing homepage. */}
      <HomepageSections />

      <section
        id="collections"
        className="collections-section"
        aria-labelledby="featured-collections-heading"
      >
        <div className="collections-header">
          <span className="collections-eyebrow">THE TANISHKA EDIT</span>
          <h2 id="featured-collections-heading">Anti-Tarnish Catalogue</h2>
          <p className="collections-subtitle">
            Curated lines crafted with ethical gold and artisan finishes.
          </p>
          <span className="collections-heading-ornament" aria-hidden="true">
            ✦
          </span>
        </div>

        {isLoading ? (
          <div
            className="collection-gridmain"
            role="status"
            aria-label="Loading collections"
          >
            {Array.from({ length: 8 }, (_, index) => (
              <div className="collection-loading-card" key={index}>
                <div className="collection-loading-image">
                  <div className="collection-loading-shimmer" />
                </div>
                <div className="collection-loading-bottom">
                  <div className="collection-loading-title" />
                  <div className="collection-loading-button" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            {usingFallbackCollections && (
              <p className="collections-fallback-note">
                Explore our signature jewellery categories.
              </p>
            )}

            <div className="collection-gridmain" role="list" aria-live="polite">
              {collections.map((col) => {
                const collectionTitle = col.title || col.name || "Collection";
                const isFallback = usingFallbackCollections;

                return (
                  <Link
                    to={
                      isFallback
                        ? `/collections/${col.id}/all-products`
                        : `/collections/${col.id}/all-products`
                    }
                    key={col.id}
                    className="collection-link"
                    role="listitem"
                    aria-label={`Open ${collectionTitle} collection`}
                    onClick={() => handleCollectionClick(col)}
                  >
                    <CollectionCard
                      id={col.id}
                      title={collectionTitle}
                      image={col.image || ""}
                      additionalImages={col.additionalImages || []}
                      alt={col.imageAlt || collectionTitle}
                    />
                  </Link>
                );
              })}
            </div>
          </>
        )}
      </section>
      <WholesaleBusinessSection />

      <InstagramReelsSection />
    </>
  );
};

export default HomePage;
