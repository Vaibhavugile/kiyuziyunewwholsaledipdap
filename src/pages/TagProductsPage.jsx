
import React, { useCallback, useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import {
  db,
  collection,
  collectionGroup,
  getDocs,
  doc,
  getDoc,
  query,
  orderBy,
  limit,
  startAfter,
} from "../firebase";
import ProductCard from "../components/ProductCard";
import ProductCardSkeleton from "../components/ProductCardSkeleton";
import {
  useCart,
  getPriceForQuantity,
  createStablePricingId,
} from "../components/CartContext";
import { useAuth } from "../components/AuthContext";
import "./TagProductsPage.css";

const PAGE_SIZE = 40;

const normalizeTag = (tag) =>
  String(tag ?? "")
    .trim()
    .toLocaleLowerCase();

const getProductTags = (product) => {
  const rawTags = [
    product.tags,
    product.tag,
    product.productTags,
  ];

  return rawTags.flatMap((value) => {
    if (Array.isArray(value)) return value;

    if (typeof value === "string") {
      return value.split(",");
    }

    return [];
  })
    .map(normalizeTag)
    .filter(Boolean);
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

  const directPrice =
    product?.retailPrice ??
    product?.salePrice ??
    product?.sellingPrice ??
    product?.price ??
    subcollection?.retailPrice ??
    subcollection?.salePrice ??
    subcollection?.sellingPrice ??
    subcollection?.price;

  if (
    directPrice === undefined ||
    directPrice === null ||
    directPrice === ""
  ) {
    return null;
  }

  const price = Number(directPrice);

  return Number.isFinite(price) ? price : null;
};

const formatTagTitle = (tag) =>
  String(tag || "Collection")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const TagProductsPage = () => {
  const { tagName } = useParams();
  const navigate = useNavigate();

  const decodedTag = (() => {
    try {
      return decodeURIComponent(tagName || "");
    } catch {
      return tagName || "";
    }
  })();

  const targetTag = normalizeTag(decodedTag);
  const title = formatTagTitle(decodedTag);

  const { cart, addToCart, removeFromCart, pricingKey } = useCart();
  const { currentUser } = useAuth();

  const [products, setProducts] = useState([]);
  const [subcollectionsMap, setSubcollectionsMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState("");
  const [lastDocument, setLastDocument] = useState(null);

  useEffect(() => {
    window.scrollTo({
      top: 0,
      left: 0,
      behavior: "auto",
    });
  }, [tagName]);

  const loadProducts = useCallback(
    async (loadMore = false) => {
      if (!targetTag) {
        setProducts([]);
        setLoading(false);
        setHasMore(false);
        setError("No collection tag was provided.");
        return;
      }

      if (loadMore && (!hasMore || loadingMore)) return;

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

        const fetchedProducts = snapshot.docs.map((productDoc) => {
          const pathParts = productDoc.ref.path.split("/");
          const subcollectionIndex = pathParts.indexOf("subcollections");

          const subcollectionId =
            subcollectionIndex >= 0
              ? pathParts[subcollectionIndex + 1]
              : "";

          const collectionIndex = pathParts.indexOf("collections");

          const collectionId =
            collectionIndex >= 0
              ? pathParts[collectionIndex + 1]
              : "";

          return {
            id: productDoc.id,
            ...productDoc.data(),
            collectionId:
              productDoc.data().mainCollection || collectionId,
            subcollectionId,
          };
        });

        const matchingProducts = fetchedProducts.filter((product) =>
          getProductTags(product).includes(targetTag)
        );

        // Load pricing metadata for any subcollections not yet cached.
        const uniqueSubcollectionIds = [
          ...new Set(
            matchingProducts
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

        const missingSubcollections = uniqueSubcollectionIds.filter(
          (key) => !subcollectionsMap[key]
        );

        const metadataEntries = await Promise.all(
          missingSubcollections.map(async (key) => {
            try {
              const [collectionId, subcollectionId] = key.split("/");

              const subcollectionRef = doc(
                db,
                "collections",
                collectionId,
                "subcollections",
                subcollectionId
              );

              const subcollectionSnap = await getDoc(subcollectionRef);

              return [
                key,
                subcollectionSnap.exists()
                  ? subcollectionSnap.data()
                  : null,
              ];
            } catch (metadataError) {
              console.warn(
                "Could not load subcollection pricing:",
                key,
                metadataError
              );

              return [key, null];
            }
          })
        );

        const updatedMap = {
          ...subcollectionsMap,
          ...Object.fromEntries(metadataEntries),
        };

        setSubcollectionsMap(updatedMap);

        const enrichedProducts = matchingProducts.map((product) => {
          const key =
            `${product.collectionId}/${product.subcollectionId}`;

          const subcollection = updatedMap[key];
          const tieredPricing =
            subcollection?.tieredPricing || product.tieredPricing;

          const calculatedPrice = getProductPrice(
            product,
            subcollection,
            pricingKey
          );

          return {
            ...product,
            tieredPricing,
            pricingKey,
            calculatedPrice,
          };
        });

        setProducts((previous) => {
          const existingIds = new Set(previous.map((product) => product.id));

          const uniqueMatches = enrichedProducts.filter(
            (product) => !existingIds.has(product.id)
          );

          return loadMore
            ? [...previous, ...uniqueMatches]
            : uniqueMatches;
        });

        setLastDocument(
          snapshot.docs[snapshot.docs.length - 1] || null
        );

        setHasMore(snapshot.docs.length === PAGE_SIZE);
      } catch (fetchError) {
        console.error("Tag products fetch failed:", fetchError);
        setError(
          "We couldn't load this collection. Please try again."
        );
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [
      targetTag,
      lastDocument,
      hasMore,
      loadingMore,
      pricingKey,
      subcollectionsMap,
    ]
  );

  useEffect(() => {
    loadProducts(false);
    // Reload when the selected tag changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetTag]);

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

    const directPrice = getProductPrice(
      product,
      subcollection,
      pricingKey
    );

    const tieredPricing =
      subcollection?.tieredPricing ||
      product.tieredPricing ||
      (directPrice !== null
        ? {
            [pricingKey]: [
              {
                min_quantity: 1,
                max_quantity: 999999,
                price: directPrice,
              },
            ],
          }
        : null);

    const roleTiers = tieredPricing?.[pricingKey];

    if (!Array.isArray(roleTiers) || !roleTiers.length) {
      alert("Price information is not available for this product yet.");
      return;
    }

    const pricingId = createStablePricingId(roleTiers);

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
      pricingId,
      variation,
      quantity: product.quantity,
    });
  };

  const handleRemoveFromCart = (cartItemId) => {
    removeFromCart(cartItemId);
  };

  const cartItems = Object.values(cart || {});

  return (
    <main className="tag-products-page">
      <div className="tag-products-shell">
        <nav className="tag-breadcrumb" aria-label="Breadcrumb">
          <Link to="/">Home</Link>
          <span>/</span>
          <span>{title}</span>
        </nav>

        <header className="tag-products-header">
          <span className="tag-products-eyebrow">
            TANISHKA COLLECTION
          </span>

          <h1>{title}</h1>

          <p>
            Explore our curated selection of products from the{" "}
            {title} collection.
          </p>

          {!loading && (
            <span className="tag-products-count">
              {products.length}{" "}
              {products.length === 1 ? "product" : "products"} loaded
            </span>
          )}
        </header>

        {error && (
          <div className="tag-products-message tag-products-error">
            <p>{error}</p>
            <button type="button" onClick={() => loadProducts(false)}>
              Try again
            </button>
          </div>
        )}

        {loading ? (
          <div className="tag-products-grid">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="tag-product-skeleton">
                <ProductCardSkeleton />
              </div>
            ))}
          </div>
        ) : (
          <>
            {products.length > 0 ? (
              <div className="tag-products-grid">
                {products.map((product) => (
                  <ProductCard
                    key={`${product.subcollectionId}-${product.id}`}
                    product={product}
                    cart={cartItems}
                    onIncrement={handleAddToCart}
                    onDecrement={handleRemoveFromCart}
                  />
                ))}
              </div>
            ) : (
              !error && (
                <div className="tag-products-message tag-products-empty">
                  <span className="tag-empty-icon">✧</span>
                  <h2>Collection coming into focus</h2>
                  <p>
                    We couldn't find products with the tag{" "}
                    <strong>{decodedTag}</strong>.
                  </p>
                  <Link to="/">Explore all collections</Link>
                </div>
              )
            )}

            {hasMore && (
              <div className="tag-load-more-wrap">
                <button
                  type="button"
                  className="tag-load-more-button"
                  onClick={() => loadProducts(true)}
                  disabled={loadingMore}
                >
                  {loadingMore ? "Loading products…" : "Load More"}
                </button>
              </div>
            )}

            {!hasMore && products.length > 0 && (
              <p className="tag-end-message">
                You've reached the end of this collection.
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
};

export default TagProductsPage;
