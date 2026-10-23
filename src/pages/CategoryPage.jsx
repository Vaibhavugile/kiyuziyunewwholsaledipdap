import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import {
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  startAfter,
} from "firebase/firestore";
import { db } from "../firebase";
import ProductCard from "../components/ProductCard";
import { useCart } from "../components/CartContext";
import { useAuth } from "../components/AuthContext";
import { trackMetaEvent } from "../utils/pixels";
import { FiArrowLeft, FiSearch, FiSliders, FiPackage } from "react-icons/fi";
import "./CategoryPage.css";

const PRODUCTS_PER_PAGE = 20;
const PREFETCH_ROOT_MARGIN = "400px";

const normalise = (value = "") =>
  String(value).trim().toLocaleLowerCase().replace(/\s+/g, " ");

const getStock = (product) => {
  if (Array.isArray(product.variations) && product.variations.length) {
    return product.variations.reduce(
      (sum, variation) => sum + (Number(variation.quantity) || 0),
      0
    );
  }
  return Number(product.quantity ?? product.current_stock ?? product.stock ?? 0);
};

const getProductCategories = (product = {}) => {
  const rawValues = [
    product.category,
    product.categoryName,
    product.mainCategory,
    product.productCategory,
    product.categoryTitle,
    product.categorySlug,
  ];
  if (Array.isArray(product.categories)) rawValues.push(...product.categories);
  if (Array.isArray(product.categoryNames)) rawValues.push(...product.categoryNames);

  return rawValues
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .map((value) => {
      if (value && typeof value === "object") {
        return value.name || value.title || value.label || value.categoryName || "";
      }
      return value;
    })
    .map((value) => String(value || "").trim())
    .filter((value) => value && normalise(value) !== "other");
};

const isUncategorisedProduct = (product) => getProductCategories(product).length === 0;

const productFromSnapshot = (productDoc) => {
  const data = productDoc.data();
  const pathParts = productDoc.ref.path.split("/");
  const collectionIndex = pathParts.indexOf("collections");
  const subcollectionIndex = pathParts.indexOf("subcollections");
  const collectionId = collectionIndex >= 0
    ? pathParts[collectionIndex + 1]
    : data?.mainCollection || data?.collectionId || data?.collection;
  const subcollectionId = subcollectionIndex >= 0
    ? pathParts[subcollectionIndex + 1]
    : data?.subcollectionId;

  return {
    id: productDoc.id,
    ...data,
    collectionId,
    mainCollection: data?.mainCollection || collectionId,
    subcollectionId,
    _documentPath: productDoc.ref.path,
  };
};

export default function CategoryPage() {
  const { categorySlug } = useParams();
  const navigate = useNavigate();
  const { cart, addToCart, removeFromCart } = useCart();
  const { currentUser, roleConfig } = useAuth();

  const [categoryTitle, setCategoryTitle] = useState("");
  const [categoryRecord, setCategoryRecord] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState("");
  const [searchText, setSearchText] = useState("");
  const [debouncedSearchText, setDebouncedSearchText] = useState("");
  const [sortBy, setSortBy] = useState("default");

  const lastVisibleRef = useRef(null);
  const loadMoreRef = useRef(null);
  const requestInProgressRef = useRef(false);
  const cancelledRef = useRef(false);
  const metadataCacheRef = useRef(new Map());
  const scannedDocumentPathsRef = useRef(new Set());
  const scanCursorRef = useRef(null);
  const isScanExhaustedRef = useRef(false);

  const categoryKey = decodeURIComponent(categorySlug || "").replace(/-/g, " ");
  const isAllRoute = normalise(categoryKey) === "all";
  const isOtherRoute = normalise(categoryKey) === "other";
  const pricingKey = roleConfig?.pricingKey || "retail";

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [categorySlug]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchText(searchText.trim()), 350);
    return () => clearTimeout(timer);
  }, [searchText]);

  const enrichWithPricing = useCallback(async (rawProducts) => {
    const needed = new Map();
    rawProducts.forEach((product) => {
      if (!product.collectionId || !product.subcollectionId || product.tieredPricing) return;
      const key = `${product.collectionId}/${product.subcollectionId}`;
      if (!metadataCacheRef.current.has(key)) {
        needed.set(key, {
          collectionId: product.collectionId,
          subcollectionId: product.subcollectionId,
        });
      }
    });

    await Promise.all([...needed.entries()].map(async ([key, ids]) => {
      try {
        const metadataRef = doc(
          db,
          "collections",
          ids.collectionId,
          "subcollections",
          ids.subcollectionId
        );
        const snap = await getDoc(metadataRef);
        metadataCacheRef.current.set(key, snap.exists() ? snap.data() : null);
      } catch (metadataError) {
        console.warn("Could not load subcollection pricing metadata:", metadataError);
        metadataCacheRef.current.set(key, null);
      }
    }));

    return rawProducts.map((product) => {
      const key = `${product.collectionId}/${product.subcollectionId}`;
      const metadata = metadataCacheRef.current.get(key);
      return {
        ...product,
        tieredPricing: product.tieredPricing || metadata?.tieredPricing || null,
      };
    });
  }, []);

  // Resolve the saved category once per route, then fetch only one page of products.
  useEffect(() => {
    let cancelled = false;
    cancelledRef.current = false;
    requestInProgressRef.current = false;
    lastVisibleRef.current = null;
    scanCursorRef.current = null;
    isScanExhaustedRef.current = false;
    scannedDocumentPathsRef.current = new Set();
    metadataCacheRef.current = new Map();

    const initialise = async () => {
      setLoading(true);
      setIsFetchingMore(false);
      setHasMore(true);
      setError("");
      setProducts([]);
      setSearchText("");
      setDebouncedSearchText("");

      try {
        const settingsSnap = await getDoc(doc(db, "settings", "productCategories"));
        const savedCategories = settingsSnap.exists()
          ? settingsSnap.data()?.categories
          : [];
        const categories = Array.isArray(savedCategories) ? savedCategories : [];

        const matchedCategory = isAllRoute || isOtherRoute
          ? null
          : categories.find((item) => {
              if (typeof item === "string") return normalise(item) === normalise(categoryKey);
              return [
                item?.title,
                item?.name,
                item?.category,
                item?.slug,
                item?.categorySlug,
                item?.id,
              ].some((value) => normalise(value) === normalise(categoryKey));
            });

        const title = isAllRoute
          ? "All Categories"
          : isOtherRoute
            ? "Other"
            : typeof matchedCategory === "string"
              ? matchedCategory
              : matchedCategory?.title || matchedCategory?.name || matchedCategory?.category || categoryKey;

        if (cancelled) return;
        setCategoryTitle(title);
        setCategoryRecord(typeof matchedCategory === "object" ? matchedCategory : null);

        // Fetch first page. All and Other use collection-group pagination.
        // Named categories use a server-side category filter to avoid downloading unrelated products.
        let pageQuery;
        if (!isAllRoute && !isOtherRoute) {
          pageQuery = query(
            collectionGroup(db, "products"),
            where("category", "==", title),
            orderBy("productCode"),
            limit(PRODUCTS_PER_PAGE)
          );
        } else {
          pageQuery = query(
            collectionGroup(db, "products"),
            orderBy("productCode"),
            limit(PRODUCTS_PER_PAGE)
          );
        }

        const snap = await getDocs(pageQuery);
        if (cancelled) return;

        let pageProducts = snap.docs.map(productFromSnapshot);
        lastVisibleRef.current = snap.docs[snap.docs.length - 1] || null;

        if (isOtherRoute) {
          // Other means products without a category. Continue scanning small pages as needed,
          // rather than downloading the full catalogue in one request.
          pageProducts = pageProducts.filter(isUncategorisedProduct);
          scannedDocumentPathsRef.current = new Set(snap.docs.map((d) => d.ref.path));
          scanCursorRef.current = lastVisibleRef.current;
          isScanExhaustedRef.current = snap.docs.length < PRODUCTS_PER_PAGE;
          setHasMore(!isScanExhaustedRef.current);
        } else {
          setHasMore(snap.docs.length === PRODUCTS_PER_PAGE);
        }

        const enriched = await enrichWithPricing(pageProducts);
        if (cancelled) return;
        setProducts(enriched);
        trackMetaEvent("ViewContent", {
          content_name: title,
          content_ids: enriched.map((product) => product.id),
          content_type: "product",
        });
      } catch (loadError) {
        console.error("Failed to load category products:", loadError);
        if (!cancelled) {
          setError(
            "Could not load products for this category. Check Firestore rules, product category fields, and any required Firestore index."
          );
          setHasMore(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    initialise();
    return () => {
      cancelled = true;
      cancelledRef.current = true;
    };
  }, [categorySlug, categoryKey, isAllRoute, isOtherRoute, enrichWithPricing]);

  const fetchNextPage = useCallback(async () => {
    if (
      requestInProgressRef.current ||
      loading ||
      isFetchingMore ||
      !hasMore ||
      !lastVisibleRef.current
    ) return;

    requestInProgressRef.current = true;
    setIsFetchingMore(true);

    try {
      const nextQuery = query(
        collectionGroup(db, "products"),
        ...(!isAllRoute && !isOtherRoute ? [where("category", "==", categoryTitle)] : []),
        orderBy("productCode"),
        startAfter(isOtherRoute ? scanCursorRef.current : lastVisibleRef.current),
        limit(PRODUCTS_PER_PAGE)
      );

      if (isOtherRoute) {
        // Scan in pages until enough uncategorised products are found to fill the next screen.
        let cursor = scanCursorRef.current;
        let exhausted = false;
        const matches = [];
        while (matches.length < PRODUCTS_PER_PAGE && !exhausted && !cancelledRef.current) {
          const scanQuery = query(
            collectionGroup(db, "products"),
            orderBy("productCode"),
            ...(cursor ? [startAfter(cursor)] : []),
            limit(PRODUCTS_PER_PAGE)
          );
          const snap = await getDocs(scanQuery);
          if (snap.empty) {
            exhausted = true;
            break;
          }
          cursor = snap.docs[snap.docs.length - 1];
          snap.docs.forEach((d) => scannedDocumentPathsRef.current.add(d.ref.path));
          matches.push(...snap.docs.map(productFromSnapshot).filter(isUncategorisedProduct));
          exhausted = snap.docs.length < PRODUCTS_PER_PAGE;
        }
        if (cancelledRef.current) return;
        scanCursorRef.current = cursor;
        lastVisibleRef.current = cursor;
        isScanExhaustedRef.current = exhausted;
        const unique = matches.filter((p) => !products.some((old) => old._documentPath === p._documentPath));
        const enriched = await enrichWithPricing(unique.slice(0, PRODUCTS_PER_PAGE));
        if (cancelledRef.current) return;
        setProducts((prev) => [...prev, ...enriched]);
        setHasMore(!exhausted);
        return;
      }

      const snap = await getDocs(nextQuery);
      if (cancelledRef.current) return;
      if (snap.empty) {
        setHasMore(false);
        return;
      }

      lastVisibleRef.current = snap.docs[snap.docs.length - 1];
      const existing = new Set(products.map((p) => p._documentPath));
      const nextProducts = snap.docs
        .map(productFromSnapshot)
        .filter((p) => !existing.has(p._documentPath));
      const enriched = await enrichWithPricing(nextProducts);
      if (cancelledRef.current) return;
      setProducts((prev) => [...prev, ...enriched]);
      setHasMore(snap.docs.length === PRODUCTS_PER_PAGE);
    } catch (loadError) {
      console.error("Failed to fetch more category products:", loadError);
      setError("Could not load more products. Please try again.");
      setHasMore(false);
    } finally {
      requestInProgressRef.current = false;
      if (!cancelledRef.current) setIsFetchingMore(false);
    }
  }, [
    loading,
    isFetchingMore,
    hasMore,
    isAllRoute,
    isOtherRoute,
    categoryTitle,
    products,
    enrichWithPricing,
  ]);

  // Load the next batch when the sentinel gets close to the viewport.
  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !hasMore || loading) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) fetchNextPage();
      },
      { root: null, rootMargin: PREFETCH_ROOT_MARGIN, threshold: 0.01 }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [fetchNextPage, hasMore, loading, products.length]);

  const visibleProducts = useMemo(() => {
    const term = normalise(debouncedSearchText);
    let result = products.filter((product) => {
      const text = normalise(
        `${product.productName || ""} ${product.productCode || ""} ${product.brandName || ""} ${product.productType || ""}`
      );
      const isAvailable = getStock(product) > 0 || product.available === true;
      return isAvailable && (!term || text.includes(term));
    });

    if (sortBy === "name-asc") {
      result.sort((a, b) => String(a.productName || "").localeCompare(String(b.productName || "")));
    } else if (sortBy === "price-asc" || sortBy === "price-desc") {
      result.sort((a, b) => {
        const getPrice = (product) => {
          const tiers = product.tieredPricing?.[pricingKey] || [];
          const firstTier = [...tiers].sort(
            (x, y) => Number(x.min_quantity ?? x.minQuantity ?? 1) - Number(y.min_quantity ?? y.minQuantity ?? 1)
          )[0];
          const value = firstTier?.price ?? product.retailPrice ?? product.salePrice ?? product.sellingPrice ?? product.price;
          const number = Number(value);
          return Number.isFinite(number) ? number : Infinity;
        };
        const priceA = getPrice(a);
        const priceB = getPrice(b);
        return sortBy === "price-asc" ? priceA - priceB : priceB - priceA;
      });
    }
    return result;
  }, [products, debouncedSearchText, sortBy, pricingKey]);

  const handleIncrement = useCallback((productWithVariation) => {
    if (!currentUser) {
      navigate("/login");
      return;
    }
    addToCart({
      ...productWithVariation,
      collectionId: productWithVariation.collectionId || productWithVariation.mainCollection,
      subcollectionId: productWithVariation.subcollectionId,
    });
    trackMetaEvent("AddToCart", {
      content_name: productWithVariation.productName,
      content_ids: [productWithVariation.id],
      content_type: "product",
      currency: "INR",
    });
  }, [currentUser, addToCart, navigate]);

  const handleDecrement = useCallback((cartItemId) => {
    removeFromCart(cartItemId);
  }, [removeFromCart]);

  return (
    <main className="category-page">
      <div className="category-page-inner">
        <div className="category-breadcrumb">
          <Link to="/" aria-label="Back to home"><FiArrowLeft /> Home</Link>
          <span>/</span>
          <span>{categoryTitle || categoryKey}</span>
        </div>

        <header className="category-page-header">
          {categoryRecord?.image || categoryRecord?.imageUrl ? (
            <div className="category-page-image-wrap">
              <img
                src={categoryRecord.image || categoryRecord.imageUrl}
                alt={categoryTitle}
                className="category-page-image"
                loading="lazy"
                decoding="async"
              />
            </div>
          ) : null}
          <div className="category-page-heading">
            <span className="category-page-eyebrow">EXPLORE OUR CATALOGUE</span>
            <h1>{categoryTitle || categoryKey}</h1>
            <p>
              {isAllRoute
                ? "Explore products from every category in our catalogue."
                : isOtherRoute
                  ? "Discover products that haven't been assigned to a category yet."
                  : `Discover products in ${categoryTitle || categoryKey}.`}
            </p>
          </div>
          <div className="category-page-count">
            <FiPackage />
            <span>{loading ? "Loading products…" : `${visibleProducts.length} products loaded`}</span>
          </div>
        </header>

        <section className="category-toolbar" aria-label="Search and sort products">
          <label className="category-search">
            <FiSearch aria-hidden="true" />
            <input
              type="search"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder={`Search ${categoryTitle ? `in ${categoryTitle}` : "products"}…`}
              aria-label="Search products in this category"
            />
          </label>
          <label className="category-sort">
            <FiSliders aria-hidden="true" />
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value)} aria-label="Sort products">
              <option value="default">Recommended</option>
              <option value="name-asc">Name: A to Z</option>
              <option value="price-asc">Price: Low to High</option>
              <option value="price-desc">Price: High to Low</option>
            </select>
          </label>
        </section>

        {error ? (
          <div className="category-state category-error">{error}</div>
        ) : loading ? (
          <div className="category-state"><span className="category-spinner" /> Loading products…</div>
        ) : visibleProducts.length === 0 && !hasMore ? (
          <div className="category-state category-empty">
            <FiPackage />
            <h2>No products found</h2>
            <p>{debouncedSearchText ? "Try another name, brand or product code." : "There are currently no available products in this category."}</p>
            <Link to="/">Browse all categories</Link>
          </div>
        ) : (
          <>
            <div className="category-product-grid">
              {visibleProducts.map((product) => (
                <ProductCard
                  key={`${product.collectionId}-${product.subcollectionId}-${product.id}`}
                  product={product}
                  cart={cart}
                  onIncrement={handleIncrement}
                  onDecrement={handleDecrement}
                />
              ))}
            </div>
            <div className="category-load-more" ref={loadMoreRef} aria-live="polite">
              {isFetchingMore ? (
                <span className="category-load-more-status"><span className="category-spinner" /> Loading more products…</span>
              ) : hasMore ? (
                <span className="category-load-more-status">Scroll to load more</span>
              ) : null}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
