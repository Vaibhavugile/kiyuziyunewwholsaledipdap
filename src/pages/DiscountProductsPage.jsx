
import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  db,
  getDocs,
  doc,
  getDoc,
  query,
  orderBy,
  limit,
  startAfter,
} from "../firebase";
import { collectionGroup } from "firebase/firestore";
import ProductCard from "../components/ProductCard";
import ProductCardSkeleton from "../components/ProductCardSkeleton";
import {
  useCart,
  getPriceForQuantity,
  createStablePricingId,
} from "../components/CartContext";
import { useAuth } from "../components/AuthContext";
import "./DiscountProductsPage.css";

const PAGE_SIZE = 40;

const DISCOUNT_RANGES = {
  "40-50": { title: "40–50% OFF", min: 40, max: 50 },
  "50-60": { title: "50–60% OFF", min: 50, max: 60 },
  "60-70": { title: "60–70% OFF", min: 60, max: 70 },
  "70-80": { title: "70–80% OFF", min: 70, max: 80 },
  "80-90": { title: "80–90% OFF", min: 80, max: 90 },
  "90-plus": { title: "90% OFF & ABOVE", min: 90, max: Infinity },
};

const getDiscount = (product) => {
  const savedDiscount =
    product.discountPercentage ??
    product.discount_percentage ??
    product.commercialData?.discountPercentage;

  // Use the saved percentage when it is greater than zero.
  const parsedDiscount = Number(savedDiscount);

  if (
    savedDiscount !== undefined &&
    savedDiscount !== null &&
    savedDiscount !== "" &&
    Number.isFinite(parsedDiscount) &&
    parsedDiscount > 0
  ) {
    return parsedDiscount;
  }

  // Fallback: calculate the discount from the original and selling prices.
  const originalPrice = Number(
    product.compareAtPrice ??
    product.compare_at_price ??
    product.originalPrice
  );

  const sellingPrice = Number(
    product.retailPrice ??
    product.salePrice ??
    product.sellingPrice ??
    product.price
  );

  if (
    Number.isFinite(originalPrice) &&
    Number.isFinite(sellingPrice) &&
    originalPrice > 0 &&
    sellingPrice >= 0 &&
    originalPrice > sellingPrice
  ) {
    return ((originalPrice - sellingPrice) / originalPrice) * 100;
  }

  return null;
};

const getProductPrice = (product, subcollection, pricingKey) => {
  const tieredPricing =
    subcollection?.tieredPricing || product?.tieredPricing;

  const tiers = tieredPricing?.[pricingKey];

  if (Array.isArray(tiers) && tiers.length) {
    const price = getPriceForQuantity(tiers, 1);

    if (Number.isFinite(Number(price))) {
      return Number(price);
    }
  }

  const value =
    product?.retailPrice ??
    product?.salePrice ??
    product?.sellingPrice ??
    product?.price ??
    subcollection?.retailPrice ??
    subcollection?.salePrice ??
    subcollection?.sellingPrice ??
    subcollection?.price;

  if (value === undefined || value === null || value === "") {
    return null;
  }

  const price = Number(value);
  return Number.isFinite(price) ? price : null;
};

const DiscountProductsPage = () => {
  const { discount } = useParams();
  const navigate = useNavigate();

  const range = DISCOUNT_RANGES[discount];

  const { cart, addToCart, removeFromCart, pricingKey } = useCart();
  const { currentUser } = useAuth();

  const [products, setProducts] = useState([]);
  const [subcollectionsMap, setSubcollectionsMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [lastDocument, setLastDocument] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [discount]);

  const loadProducts = useCallback(
    async (loadMore = false) => {
      if (!range) {
        setLoading(false);
        setHasMore(false);
        setError("This discount range does not exist.");
        return;
      }

      if (loadMore && (loadingMore || !hasMore)) return;

      if (loadMore) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        setError("");
        setProducts([]);
        setLastDocument(null);
        setHasMore(true);
      }

      try {
        const cursor = loadMore ? lastDocument : null;

        const constraints = [
          collectionGroup(db, "products"),
          orderBy("productCode"),
        ];

        if (cursor) {
          constraints.push(startAfter(cursor));
        }

        constraints.push(limit(PAGE_SIZE));

        const snapshot = await getDocs(query(...constraints));

        const fetched = snapshot.docs.map((productDoc) => {
          const pathParts = productDoc.ref.path.split("/");
          const subcollectionIndex = pathParts.indexOf("subcollections");
          const collectionIndex = pathParts.indexOf("collections");
          const data = productDoc.data();

          return {
            id: productDoc.id,
            ...data,
            collectionId:
              data.mainCollection ||
              (collectionIndex >= 0
                ? pathParts[collectionIndex + 1]
                : ""),
            subcollectionId:
              subcollectionIndex >= 0
                ? pathParts[subcollectionIndex + 1]
                : "",
          };
        });

        const matching = fetched.filter((product) => {
          const value = getDiscount(product);

          if (value === null || value < range.min) return false;

          return range.max === Infinity
            ? value >= 90
            : value < range.max;
        });

        const metadataKeys = [
          ...new Set(
            matching
              .filter(
                (product) =>
                  product.collectionId && product.subcollectionId
              )
              .map(
                (product) =>
                  `${product.collectionId}/${product.subcollectionId}`
              )
          ),
        ];

        const missingKeys = metadataKeys.filter(
          (key) => !subcollectionsMap[key]
        );

        const metadataResults = await Promise.all(
          missingKeys.map(async (key) => {
            try {
              const [collectionId, subcollectionId] = key.split("/");

              const ref = doc(
                db,
                "collections",
                collectionId,
                "subcollections",
                subcollectionId
              );

              const result = await getDoc(ref);

              return [key, result.exists() ? result.data() : null];
            } catch (metadataError) {
              console.warn("Subcollection metadata unavailable:", metadataError);
              return [key, null];
            }
          })
        );

        const updatedMap = {
          ...subcollectionsMap,
          ...Object.fromEntries(metadataResults),
        };

        setSubcollectionsMap(updatedMap);

        const enriched = matching.map((product) => {
          const key =
            `${product.collectionId}/${product.subcollectionId}`;

          const subcollection = updatedMap[key];

          return {
            ...product,
            tieredPricing:
              subcollection?.tieredPricing || product.tieredPricing,
            pricingKey,
            calculatedPrice: getProductPrice(
              product,
              subcollection,
              pricingKey
            ),
          };
        });

        setProducts((previous) => {
          const seen = new Set(previous.map((product) => product.id));

          const unique = enriched.filter(
            (product) => !seen.has(product.id)
          );

          return loadMore ? [...previous, ...unique] : unique;
        });

        setLastDocument(snapshot.docs.at(-1) || null);
        setHasMore(snapshot.docs.length === PAGE_SIZE);
      } catch (fetchError) {
        console.error("Discount products fetch failed:", fetchError);
        setError("Unable to load discounted products. Please try again.");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [
      range,
      lastDocument,
      loadingMore,
      hasMore,
      subcollectionsMap,
      pricingKey,
    ]
  );

  useEffect(() => {
    loadProducts(false);
    // Start a fresh search when the route's discount range changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discount]);

  const handleAddToCart = (product, variation) => {
    if (!currentUser) {
      alert("Please log in to add products to your cart.");
      navigate("/login");
      return;
    }

    const subcollection =
      subcollectionsMap[
        `${product.collectionId}/${product.subcollectionId}`
      ];

    const price = getProductPrice(product, subcollection, pricingKey);

    const tieredPricing =
      subcollection?.tieredPricing ||
      product.tieredPricing ||
      (price !== null
        ? {
            [pricingKey]: [
              {
                min_quantity: 1,
                max_quantity: 999999,
                price,
              },
            ],
          }
        : null);

    const tiers = tieredPricing?.[pricingKey];

    if (!Array.isArray(tiers) || !tiers.length) {
      alert("Price information is not available for this product yet.");
      return;
    }

    addToCart({
      id: product.id,
      productName:
        product.productName || product.name || product.title || "Product",
      productCode: product.productCode || product.sku || "",
      image:
        product.image ||
        product.imageUrl ||
        product.thumbnail ||
        product.imageUrls?.[0] ||
        "",
      images: product.images || product.additionalImages || [],
      tieredPricing,
      subcollectionId: product.subcollectionId,
      collectionId: product.collectionId,
      pricingId: createStablePricingId(tiers),
      variation,
      quantity: product.quantity,
    });
  };

  if (!range) {
    return (
      <main className="discount-page">
        <div className="discount-page-shell">
          <div className="discount-message">
            <h1>Discount range not found</h1>
            <Link to="/">Return to homepage</Link>
          </div>
        </div>
      </main>
    );
  }

  const cartItems = Object.values(cart || {});

  return (
    <main className="discount-page">
      <div className="discount-page-shell">
        <nav className="discount-breadcrumb" aria-label="Breadcrumb">
          <Link to="/">Home</Link>
          <span>/</span>
          <span>Shop by Discount</span>
          <span>/</span>
          <strong>{range.title}</strong>
        </nav>

        <header className="discount-page-header">
          <span className="discount-page-eyebrow">
            SPECIAL SAVINGS COLLECTION
          </span>

          <h1>{range.title}</h1>

          <p>
            Explore products that match this discount range.
          </p>

          <span className="discount-page-ornament" aria-hidden="true">
            ✦
          </span>
        </header>

        <nav className="discount-range-nav" aria-label="Discount ranges">
          {Object.entries(DISCOUNT_RANGES).map(([id, item]) => (
            <Link
              key={id}
              to={`/discount/${id}`}
              className={id === discount ? "active" : ""}
              aria-current={id === discount ? "page" : undefined}
            >
              {item.title}
            </Link>
          ))}
        </nav>

        {error && (
          <div className="discount-message discount-error">
            <p>{error}</p>
            <button type="button" onClick={() => loadProducts(false)}>
              Try again
            </button>
          </div>
        )}

        {loading ? (
          <div className="discount-product-grid">
            {Array.from({ length: 8 }, (_, index) => (
              <div key={index}>
                <ProductCardSkeleton />
              </div>
            ))}
          </div>
        ) : (
          <>
            {products.length > 0 ? (
              <>
                <div className="discount-results-heading">
                  <span>
                    {products.length} products loaded
                  </span>
                  <span>{range.title}</span>
                </div>

                <div className="discount-product-grid">
                  {products.map((product) => (
                    <div
                      key={`${product.subcollectionId}-${product.id}`}
                      className="discount-product-item"
                    >
                      <ProductCard
                        product={product}
                        cart={cartItems}
                        onIncrement={handleAddToCart}
                        onDecrement={(id) => removeFromCart(id)}
                      />
                    </div>
                  ))}
                </div>
              </>
            ) : (
              !error && (
                <div className="discount-message discount-empty">
                  <span aria-hidden="true">✧</span>
                  <h2>No matching products found yet</h2>
                  <p>
                    We couldn't find products in this range among the
                    products loaded so far. Try loading more products
                    or explore another discount range.
                  </p>
                </div>
              )
            )}

            {hasMore && (
              <div className="discount-load-more-wrap">
                <button
                  type="button"
                  className="discount-load-more"
                  disabled={loadingMore}
                  onClick={() => loadProducts(true)}
                >
                  {loadingMore ? "Finding more deals…" : "Load More Products"}
                </button>
              </div>
            )}

            {!hasMore && products.length > 0 && (
              <p className="discount-end-message">
                You've reached the end of the available products.
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
};

export default DiscountProductsPage;
