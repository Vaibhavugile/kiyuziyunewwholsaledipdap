
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  collectionGroup,
  getDocs,
  query,
  orderBy,
  limit,
  startAfter,
  doc,
  getDoc,
} from "firebase/firestore";

import { db } from "../firebase";
import ProductCard from "../components/ProductCard";
import ProductCardSkeleton from "../components/ProductCardSkeleton";
import { useCart, getPriceForQuantity } from "../components/CartContext";
import { useAuth } from "../components/AuthContext";
import "./BudgetProductsPage.css";

const PAGE_SIZE = 60;

const BUDGETS = {
  "under-9": { title: "Under ₹9", min: 0, max: 9 },
  "under-49": { title: "Under ₹49", min: 9, max: 49 },
  "under-99": { title: "Under ₹99", min: 49, max: 99 },
  "under-199": { title: "Under ₹199", min: 99, max: 199 },
  "under-299": { title: "Under ₹299", min: 199, max: 299 },
  "under-499": { title: "Under ₹499", min: 299, max: 499 },
  "under-999": { title: "Under ₹999", min: 499, max: 999 },
};

const getDirectPrice = (product, subcollection) => {
  const values = [
    product?.retailPrice,
    product?.salePrice,
    product?.sellingPrice,
    product?.price,
    subcollection?.retailPrice,
    subcollection?.salePrice,
    subcollection?.sellingPrice,
    subcollection?.price,
  ];

  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") {
      const price = Number(value);
      if (Number.isFinite(price) && price >= 0) return price;
    }
  }

  return null;
};

const getProductPrice = (product, subcollection, pricingKey) => {
  const tiers =
    subcollection?.tieredPricing?.[pricingKey] ||
    product?.tieredPricing?.[pricingKey];

  if (Array.isArray(tiers) && tiers.length) {
    const tierPrice = getPriceForQuantity(tiers, 1);
    if (Number.isFinite(Number(tierPrice))) return Number(tierPrice);
  }

  return getDirectPrice(product, subcollection);
};

const isProductAvailable = (product) => {
  if (product?.available === false) return false;
  if (product?.status && String(product.status).toLowerCase() !== "active") {
    return false;
  }

  const tracksInventory =
    product?.trackInventory === true ||
    product?.trackInventory === "true";

  if (tracksInventory) {
    const stock = Number(product?.current_stock ?? product?.quantity ?? 0);
    if (!Number.isFinite(stock) || stock <= 0) return false;
  }

  return true;
};

const getProductPathInfo = (productDoc) => {
  const path = productDoc.ref.path.split("/");
  const productIndex = path.lastIndexOf("products");

  if (productIndex < 3) {
    return {
      collectionId: productDoc.data().mainCollection || "",
      subcollectionId: productDoc.data().subcollectionId || "",
    };
  }

  return {
    collectionId: path[productIndex - 3] || "",
    subcollectionId: path[productIndex - 1] || "",
  };
};

const BudgetProductsPage = () => {
  const { budgetId } = useParams();
  const budget = BUDGETS[budgetId];

  const { addToCart, removeFromCart, cart } = useCart();
  const { currentUser } = useAuth();

  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [lastDoc, setLastDoc] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [sortBy, setSortBy] = useState("default");

  const pricingKey = "wholesaler";

  const fetchPage = useCallback(
    async (cursor = null, reset = false) => {
      if (!budget) {
        setProducts([]);
        setLoading(false);
        setHasMore(false);
        return;
      }

      if (reset) {
        setLoading(true);
        setError("");
      } else {
        setLoadingMore(true);
      }

      try {
        const productsRef = collectionGroup(db, "products");
        const constraints = [
          orderBy("productCode"),
          limit(PAGE_SIZE),
        ];

        if (cursor) constraints.splice(1, 0, startAfter(cursor));

        const snapshot = await getDocs(query(productsRef, ...constraints));

        const rawProducts = snapshot.docs.map((productDoc) => ({
          id: productDoc.id,
          ...productDoc.data(),
          ...getProductPathInfo(productDoc),
        }));

        const subcollectionIds = [
          ...new Set(
            rawProducts
              .map((product) => product.subcollectionId)
              .filter(Boolean)
          ),
        ];

        const subcollectionsMap = {};

        await Promise.all(
          subcollectionIds.map(async (subcollectionId) => {
            const collectionIds = [
              ...new Set(
                rawProducts
                  .filter(
                    (product) =>
                      product.subcollectionId === subcollectionId
                  )
                  .map((product) => product.collectionId)
                  .filter(Boolean)
              ),
            ];

            await Promise.all(
              collectionIds.map(async (collectionId) => {
                try {
                  const subcollectionRef = doc(
                    db,
                    "collections",
                    collectionId,
                    "subcollections",
                    subcollectionId
                  );
                  const subcollectionSnap = await getDoc(subcollectionRef);

                  if (subcollectionSnap.exists()) {
                    subcollectionsMap[
                      `${collectionId}/${subcollectionId}`
                    ] = subcollectionSnap.data();
                  }
                } catch (subcollectionError) {
                  console.error(
                    "Could not load subcollection pricing:",
                    subcollectionError
                  );
                }
              })
            );
          })
        );

        const matchingProducts = rawProducts
          .map((product) => {
            const subcollection =
              subcollectionsMap[
                `${product.collectionId}/${product.subcollectionId}`
              ];

            const price = getProductPrice(
              product,
              subcollection,
              pricingKey
            );

            return {
              ...product,
              subcollectionData: subcollection || null,
              calculatedPrice: price,
              tieredPricing:
                subcollection?.tieredPricing || product.tieredPricing || null,
              image:
                product.image ||
                product.imageUrl ||
                product.thumbnail ||
                product.imageUrls?.[0] ||
                product.additionalImages?.[0] ||
                product.images?.[0] ||
                "",
            };
          })
          .filter((product) => {
            if (!isProductAvailable(product)) return false;

            const price = product.calculatedPrice;
            if (price === null || !Number.isFinite(price)) return false;

            // Price bands do not overlap:
            // Under ₹49 excludes items priced ₹9 or less, etc.
            const isInRange =
              (budget.min === 0
                ? price >= budget.min
                : price > budget.min) &&
              price <= budget.max;

            return isInRange;
          });

        setProducts((previous) =>
          reset ? matchingProducts : [...previous, ...matchingProducts]
        );

        setLastDoc(
          snapshot.docs.length
            ? snapshot.docs[snapshot.docs.length - 1]
            : null
        );
        setHasMore(snapshot.docs.length === PAGE_SIZE);
      } catch (fetchError) {
        console.error("Budget products fetch failed:", fetchError);
        setError("We couldn't load products. Please try again.");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [budget, pricingKey]
  );

  useEffect(() => {
    setProducts([]);
    setLastDoc(null);
    setHasMore(true);
    fetchPage(null, true);
  }, [fetchPage]);

  const displayedProducts = useMemo(() => {
    const result = [...products];

    if (sortBy === "price-low") {
      result.sort(
        (a, b) => a.calculatedPrice - b.calculatedPrice
      );
    } else if (sortBy === "price-high") {
      result.sort(
        (a, b) => b.calculatedPrice - a.calculatedPrice
      );
    } else if (sortBy === "name") {
      result.sort((a, b) =>
        String(a.productName || a.name || "").localeCompare(
          String(b.productName || b.name || "")
        )
      );
    }

    return result;
  }, [products, sortBy]);

  const handleAddToCart = async (product) => {
    if (!currentUser) {
      window.alert("Please log in to add products to your cart.");
      return;
    }

    const roleTiers =
      product.tieredPricing?.[pricingKey] ||
      product.subcollectionData?.tieredPricing?.[pricingKey];

    const directPrice = Number(product.calculatedPrice);

    // Preserve role-based tiers. For products without tiers, create a
    // single-price fallback so CartContext can calculate the cart price.
    const tieredPricing =
      Array.isArray(roleTiers) && roleTiers.length
        ? product.tieredPricing
        : {
            ...(product.tieredPricing || {}),
            [pricingKey]: [
              {
                min_quantity: 1,
                max_quantity: 999999,
                price: directPrice,
              },
            ],
          };

    const productData = {
      ...product,
      id: product.id,
      productName: product.productName || product.name || "Product",
      productCode: product.productCode || product.sku || product.id,
      collectionId: product.collectionId || product.mainCollection || "",
      subcollectionId: product.subcollectionId || "",
      image: product.image || "",
      images: product.images || product.imageUrls || [],
      tieredPricing,
      pricingId: JSON.stringify(tieredPricing[pricingKey]),
      variation: product.variation || null,
    };

    try {
      await addToCart(productData);
    } catch (cartError) {
      console.error("Add to cart failed:", cartError);
      window.alert("Could not add this product to your cart. Please try again.");
    }
  };

  if (!budget) {
    return (
      <main className="budget-products-page">
        <div className="budget-products-empty">
          <h2>Budget not found</h2>
          <p>Please select one of our available budget categories.</p>
          <Link to="/">Back to homepage</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="budget-products-page">
      <nav className="budget-breadcrumb" aria-label="Breadcrumb">
        <Link to="/">Home</Link>
        <span>/</span>
        <span>{budget.title}</span>
      </nav>

      <header className="budget-products-header">
        <span className="budget-products-eyebrow">Shop by budget</span>
        <h1>{budget.title}</h1>
        <p>
          Discover products across our collections, selected for this price
          range.
        </p>
      </header>

      <nav className="budget-range-navigation" aria-label="Price ranges">
        {Object.entries(BUDGETS).map(([id, item]) => (
          <Link
            key={id}
            to={`/budget/${id}`}
            className={`budget-range-link ${
              id === budgetId ? "active" : ""
            }`}
          >
            {item.title}
          </Link>
        ))}
      </nav>

      <div className="budget-products-toolbar">
        <div className="budget-products-count">
          {loading ? (
            "Finding products..."
          ) : (
            <>
              <strong>{displayedProducts.length}</strong> products loaded
            </>
          )}
        </div>

        <select
          className="budget-products-sort"
          value={sortBy}
          onChange={(event) => setSortBy(event.target.value)}
          aria-label="Sort products"
        >
          <option value="default">Sort: Recommended</option>
          <option value="price-low">Price: Low to High</option>
          <option value="price-high">Price: High to Low</option>
          <option value="name">Name: A to Z</option>
        </select>
      </div>

      {error && (
        <div className="budget-products-error">
          <h2>Something went wrong</h2>
          <p>{error}</p>
          <button type="button" onClick={() => fetchPage(null, true)}>
            Try again
          </button>
        </div>
      )}

      {loading && (
        <div className="budget-products-loading-grid">
          {Array.from({ length: 8 }).map((_, index) => (
            <div className="budget-product-skeleton" key={index}>
              <div className="budget-product-skeleton-image" />
              <div className="budget-product-skeleton-line" />
              <div className="budget-product-skeleton-line short" />
            </div>
          ))}
        </div>
      )}

      {!loading && !error && displayedProducts.length === 0 && (
        <div className="budget-products-empty">
          <h2>No products found in this range</h2>
          <p>Try another budget category to discover more products.</p>
          <Link to="/">Explore all budgets</Link>
        </div>
      )}

      {!loading && !error && displayedProducts.length > 0 && (
        <div className="budget-products-grid">
          {displayedProducts.map((product) => (
            <ProductCard
              key={`${product.collectionId}-${product.subcollectionId}-${product.id}`}
              product={product}
              collectionId={product.collectionId}
              subcollectionId={product.subcollectionId}
              productId={product.id}
              calculatedPrice={product.calculatedPrice}
              tieredPricing={product.tieredPricing}
              additionalImages={
                product.additionalImages || product.images || []
              }
              cart={cart}
              onIncrement={() => handleAddToCart(product)}
              onDecrement={removeFromCart}
            />
          ))}
        </div>
      )}

      {!loading && hasMore && !error && (
        <div className="budget-products-loading-message">
          {loadingMore ? (
            <>
              <span className="budget-products-spinner" />
              Loading more products...
            </>
          ) : (
            <button
              type="button"
              onClick={() => fetchPage(lastDoc, false)}
            >
              Load more products
            </button>
          )}
        </div>
      )}

      {!loading && !hasMore && products.length > 0 && (
        <div className="budget-products-end-message">
          You’ve reached the end of the available products.
        </div>
      )}
    </main>
  );
};

export default BudgetProductsPage;
