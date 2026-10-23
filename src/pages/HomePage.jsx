

import React, { useState, useEffect } from "react";

import { doc, getDoc } from "firebase/firestore";

import { Link } from "react-router-dom";

import { db, collection, getDocs } from "../firebase";

import CollectionCard from "../components/CollectionCard";

import HeroSection from "../components/HeroSection";

import "./HomePage.css";

import InstagramReelsSection from "../components/InstagramReelsSection";

import { trackMetaEvent } from "../utils/pixels";

import earringImage from "../assets/hero/All Products Shopping Haul.png";

import WholesaleBusinessSection from "../components/WholesaleBusinessSection";

import CategoryCard from "../components/CategoryCard";



const FALLBACK_COLLECTIONS = [

  { id: "necklaces", title: "Necklaces", image: earringImage },

  { id: "earrings", title: "Earrings", image: earringImage },

  { id: "bangles", title: "Bangles", image: earringImage },

  { id: "bridal-sets", title: "Bridal Sets", image: earringImage },

  { id: "rings", title: "Rings", image: earringImage },

  { id: "mangalsutra", title: "Mangalsutra", image: earringImage },

  { id: "chains", title: "Chains", image: earringImage },

  { id: "new-arrivals", title: "New Arrivals", image: earringImage },

];



const BUDGET_LINKS = [

  { id: "under-9", title: "Under ₹9", subtitle: "Tiny prices, lovely finds" },

  { id: "under-49", title: "Under ₹49", subtitle: "Everyday little treats" },

  { id: "under-99", title: "Under ₹99", subtitle: "Style on a budget" },

  { id: "under-199", title: "Under ₹199", subtitle: "More to love" },

  { id: "under-299", title: "Under ₹299", subtitle: "Find your favourites" },

  { id: "under-499", title: "Under ₹499", subtitle: "Affordable elegance" },

  { id: "under-999", title: "Under ₹999", subtitle: "A little extra luxury" },

];



const DISCOUNT_LINKS = [

   {

    id: "90-plus",

    title: "90% OFF & ABOVE",

    subtitle: "Our biggest discounts",

    className: "discount-90-plus",

  },

   {

    id: "80-90",

    title: "80–90% OFF",

    subtitle: "Exceptional offers",

    className: "discount-80-90",

  },

   {

    id: "70-80",

    title: "70–80% OFF",

    subtitle: "Beautiful deals await",

    className: "discount-70-80",

  },

    {

    id: "60-70",

    title: "60–70% OFF",

    subtitle: "Deals worth discovering",

    className: "discount-60-70",

  },

    {

    id: "50-60",

    title: "50–60% OFF",

    subtitle: "More savings on favourites",

    className: "discount-50-60",

  },



  {

    id: "40-50",

    title: "40–50% OFF",

    subtitle: "Stylish finds, better prices",

    className: "discount-40-50",

  },









];



const TAG_SECTIONS = [

  {

    id: "Navratri",

    title: "Navratri Collection",

    eyebrow: "FESTIVAL EDIT",

    description: "Discover festive favourites for your celebrations.",

    theme: "festival",

  },

  {

    id: "collection_mega_savings",

    title: "Mega Savings",

    eyebrow: "SPECIAL OFFERS",

    description: "Explore products tagged for special savings.",

    theme: "savings",

  },

  {

    id: "FF Sale",

    title: "Sale Finds",

    eyebrow: "SALE EDIT",

    description: "Shop selected products from our sale collection.",

    theme: "sale",

  },

];







const HomePage = () => {

  const [collections, setCollections] = useState([]);

  const [isLoading, setIsLoading] = useState(true);

  const [usingFallbackCollections, setUsingFallbackCollections] =

    useState(false);

  const [categories, setCategories] = useState([]);

  const [isLoadingCategories, setIsLoadingCategories] = useState(true);

  const [categoryLoadError, setCategoryLoadError] = useState(false);



  useEffect(() => {

    let isMounted = true;



    const fetchCollections = async () => {

      setIsLoading(true);



      try {

        const snapshot = await getDocs(collection(db, "collections"));

        const fetched = snapshot.docs.map((item) => ({

          id: item.id,

          ...item.data(),

        }));



        fetched.sort(

          (a, b) => (a.showNumber || 0) - (b.showNumber || 0)

        );



        if (!isMounted) return;



        if (fetched.length) {

          setCollections(fetched);

          setUsingFallbackCollections(false);

        } else {

          setCollections(FALLBACK_COLLECTIONS);

          setUsingFallbackCollections(true);

        }

      } catch (error) {

        console.error("Error fetching homepage collections:", error);



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



  useEffect(() => {

    let isMounted = true;



    const fetchSavedCategories = async () => {

      setIsLoadingCategories(true);

      setCategoryLoadError(false);



      try {

        // Categories are now read from the saved settings document only.

        // No product/subcollection scan and no writes happen on the homepage.

        const settingsRef = doc(db, "settings", "productCategories");

        const settingsSnapshot = await getDoc(settingsRef);

        const savedCategories = settingsSnapshot.exists()

          ? settingsSnapshot.data()?.categories

          : [];



        const savedCategoryItems = Array.isArray(savedCategories)
          ? savedCategories
              .filter((item) => item && item.isActive !== false)
              .map((item, index) => {
                const title = item.title || item.name || item.category || "";
                const image =
                  item.image || item.imageUrl || item.imageURL || earringImage;
                return {
                  ...item,
                  id: item.id || item.categoryId || item.categorySlug || title || `category-${index + 1}`,
                  title,
                  name: item.name || title,
                  category: item.category || title,
                  image,
                  imageUrl: item.imageUrl || image,
                  imageAlt: item.imageAlt || title,
                  additionalImages: Array.isArray(item.additionalImages)
                    ? item.additionalImages
                    : [],
                  showNumber: Number.isFinite(Number(item.showNumber))
                    ? Number(item.showNumber)
                    : index + 1,
                };
              })
              .filter((item) => item.title)
              .sort((a, b) => a.showNumber - b.showNumber)
          : [];

        // Virtual catalogue cards are always shown, even when no category
        // settings have been saved in Firestore.
        const allCategoriesCard = {
          id: "all",
          title: "All",
          name: "All",
          category: "all",
          categoryType: "all",
          image: earringImage,
          imageUrl: earringImage,
          imageAlt: "Browse all products",
          additionalImages: [],
          showNumber: -1,
          isVirtualCategory: true,
        };

        const otherCategoryCard = {
          id: "other",
          title: "Other",
          name: "Other",
          category: "other",
          categoryType: "other",
          image: earringImage,
          imageUrl: earringImage,
          imageAlt: "Browse products without a category",
          additionalImages: [],
          showNumber: Number.MAX_SAFE_INTEGER,
          isVirtualCategory: true,
        };

        // Display order: All first, saved Firestore categories in the middle,
        // and Other last.
        const normalizedCategories = [
          allCategoriesCard,
          ...savedCategoryItems,
          otherCategoryCard,
        ];

        if (isMounted) setCategories(normalizedCategories);

      } catch (error) {

        console.error("Error fetching saved product categories:", error);

        if (isMounted) {

          setCategories([
            {
              id: "all",
              title: "All",
              name: "All",
              category: "all",
              categoryType: "all",
              image: earringImage,
              imageUrl: earringImage,
              imageAlt: "Browse all products",
              additionalImages: [],
              isVirtualCategory: true,
            },
            {
              id: "other",
              title: "Other",
              name: "Other",
              category: "other",
              categoryType: "other",
              image: earringImage,
              imageUrl: earringImage,
              imageAlt: "Browse products without a category",
              additionalImages: [],
              isVirtualCategory: true,
            },
          ]);

          setCategoryLoadError(true);

        }

      } finally {

        if (isMounted) setIsLoadingCategories(false);

      }

    };



    fetchSavedCategories();



    return () => {

      isMounted = false;

    };

  }, []);



  useEffect(() => {

    if (typeof IntersectionObserver === "undefined") return undefined;



    const nodes = document.querySelectorAll(

      ".collection-link, .category-link, .budget-tile, .tag-section-card, .shop-discount-card"

    );



    if (!nodes.length) return undefined;



    const observer = new IntersectionObserver(

      (entries, currentObserver) => {

        entries.forEach((entry) => {

          if (entry.isIntersecting) {

            entry.target.classList.add("reveal");

            currentObserver.unobserve(entry.target);

          }

        });

      },

      {

        rootMargin: "0px 0px -30px 0px",

        threshold: 0.06,

      }

    );



    nodes.forEach((node) => observer.observe(node));



    return () => observer.disconnect();

  }, [collections, isLoading, categories, isLoadingCategories]);



  const handleCollectionClick = (item) => {

    trackMetaEvent("ViewContent", {

      content_name: item.title || item.name || "Collection",

      content_ids: [item.id],

      content_type: "product_group",

    });

  };



  const handleCategoryClick = (item) => {

    trackMetaEvent("ViewCategory", {

      content_name: item.title,

      content_category: "Shop by Category",

      content_ids: [item.id],

    });

  };



  const handleBudgetClick = (item) => {

    trackMetaEvent("ViewCategory", {

      content_name: item.title,

      content_category: "Shop by Budget",

    });

  };



  const handleDiscountClick = (item) => {

    trackMetaEvent("ViewCategory", {

      content_name: item.title,

      content_category: "Shop by Discount",

    });

  };



  const handleTagClick = (item) => {

    trackMetaEvent("ViewCategory", {

      content_name: item.title,

      content_category: item.eyebrow,

      content_ids: [item.id],

    });

  };



  return (

    <main className="tanishka-homepage">

      <HeroSection />



      {/* DYNAMIC PRODUCT CATEGORIES */}

      <section

        id="categories"

        className="collections-section category-section"

        aria-labelledby="product-categories-heading"

      >

        <div className="collections-header">

          <span className="collections-eyebrow">FIND YOUR FAVOURITES</span>

          <h2 id="product-categories-heading">Shop by Category</h2>

          <p className="collections-subtitle">

            Explore every category available in our product catalogue.

          </p>

          <span className="collections-heading-ornament" aria-hidden="true">

            ✦

          </span>

        </div>



        {isLoadingCategories && categories.length === 0 ? (

          <div className="collection-gridmain" role="status" aria-label="Loading product categories">

            {Array.from({ length: 6 }, (_, index) => (

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

        ) : categories.length > 0 ? (

          <div className="collection-gridmain category-grid" role="list" aria-live="polite">

            {categories.map((item) => (

              <Link

                to={`/category/${encodeURIComponent(
                  item.categoryType ||
                  String(item.title || "")
                    .trim()
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                )}`}

                key={item.id}

                className="collection-link category-link"

                role="listitem"

                aria-label={`Shop ${item.title} category`}

                onClick={() => handleCategoryClick(item)}

              >

                <CategoryCard

                  id={item.id}

                  title={item.title}

                  category={item.title}

                  image={item.image || earringImage}

                  additionalImages={item.additionalImages || []}

                  alt={`${item.title} category`}

                />

              </Link>

            ))}

          </div>

        ) : (

          <p className="collections-fallback-note">

            {categoryLoadError

              ? "Categories could not be loaded. Please check your connection and try again."

              : "Product categories will appear here once products have category values."}

          </p>

        )}

      </section>



      {/* SHOP BY BUDGET */}

      <section

        className="budget-section"

        aria-labelledby="budget-section-title"

      >

        <div className="budget-section-header">

          <span className="homepage-eyebrow">BEAUTY FOR EVERY BUDGET</span>

          <h2 id="budget-section-title">Shop by Budget</h2>

          <p>Discover something beautiful at your price.</p>

          <span className="homepage-heading-ornament" aria-hidden="true">

            ✦

          </span>

        </div>



        <div className="budget-tile-grid">

          {BUDGET_LINKS.map((item, index) => (

            <Link

              key={item.id}

              to={`/budget/${item.id}`}

              className="budget-tile"

              style={{ "--tile-index": index }}

              onClick={() => handleBudgetClick(item)}

            >

              <span className="budget-tile-number">

                {String(index + 1).padStart(2, "0")}

              </span>

              <span className="budget-tile-kicker">PRICE EDIT</span>

              <strong>{item.title}</strong>

              <span className="budget-tile-subtitle">{item.subtitle}</span>

              <span className="budget-tile-arrow" aria-hidden="true">

                ↗

              </span>

            </Link>

          ))}

        </div>

      </section>



      {/* SHOP BY DISCOUNT */}

      <section

        className="shop-discount-section"

        aria-labelledby="shop-discount-title"

      >

        <div className="shop-discount-heading">

          <span className="homepage-eyebrow">MORE STYLE · LESS SPEND</span>

          <h2 id="shop-discount-title">Shop by Discount</h2>

          <p>Find your favourite styles at prices you'll love.</p>

          <span className="homepage-heading-ornament" aria-hidden="true">

            ✦

          </span>

        </div>



        <div className="shop-discount-grid">

          {DISCOUNT_LINKS.map((item, index) => (

            <Link

              key={item.id}

              to={`/discount/${item.id}`}

              className={`shop-discount-card ${item.className}`}

              style={{ "--discount-index": index }}

              onClick={() => handleDiscountClick(item)}

            >

              <span className="shop-discount-sparkle" aria-hidden="true">

                ✧

              </span>

              <span className="shop-discount-label">SPECIAL PRICE EDIT</span>

              <strong className="shop-discount-value">{item.title}</strong>

              <span className="shop-discount-subtitle">{item.subtitle}</span>

              <span className="shop-discount-cta">

                EXPLORE DEALS <span aria-hidden="true">↗</span>

              </span>

            </Link>

          ))}

        </div>

      </section>



      {/* FESTIVALS AND SPECIAL FINDS — uses existing product tags */}

      <section

        className="tag-sections-home"

        aria-labelledby="tag-sections-title"

      >

        <div className="tag-sections-heading">

          <span className="homepage-eyebrow">CURATED FOR YOU</span>

          <h2 id="tag-sections-title">Festivals &amp; Special Finds</h2>

          <p>Explore collections selected for every occasion.</p>

          <span className="homepage-heading-ornament" aria-hidden="true">

            ✦

          </span>

        </div>



        <div className="tag-sections-grid">

          {TAG_SECTIONS.map((item, index) => (

            <Link

              key={item.id}

              to={`/tag/${encodeURIComponent(item.id)}`}

              className={`tag-section-card tag-theme-${item.theme}`}

              style={{ "--tag-index": index }}

              onClick={() => handleTagClick(item)}

            >

              <div className="tag-section-image-wrap">

                <img

                  src={earringImage}

                  alt=""

                  className="tag-section-image"

                  loading="lazy"

                />

                <span className="tag-section-image-overlay" />

                <span className="tag-section-symbol" aria-hidden="true">

                  ✧

                </span>

              </div>



              <div className="tag-section-content">

                <span className="tag-section-eyebrow">{item.eyebrow}</span>

                <h3>{item.title}</h3>

                <p>{item.description}</p>

                <span className="tag-section-link">

                  DISCOVER COLLECTION <span aria-hidden="true">↗</span>

                </span>

              </div>

            </Link>

          ))}

        </div>

      </section>



      {/* EXISTING CATALOGUE */}

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

              {collections.map((item) => {

                const collectionTitle =

                  item.title || item.name || "Collection";



                return (

                  <Link

                    to={`/collections/${item.id}/all-products`}

                    key={item.id}

                    className="collection-link"

                    role="listitem"

                    aria-label={`Open ${collectionTitle} collection`}

                    onClick={() => handleCollectionClick(item)}

                  >

                    <CollectionCard

                      id={item.id}

                      title={collectionTitle}

                      image={item.image || earringImage}

                      additionalImages={item.additionalImages || []}

                      alt={item.imageAlt || collectionTitle}

                    />

                  </Link>

                );

              })}

            </div>

          </>

        )}

      </section>



      {/* EXISTING BUSINESS AND SOCIAL SECTIONS */}

      <WholesaleBusinessSection />

      <InstagramReelsSection />

    </main>

  );

};



export default HomePage;
