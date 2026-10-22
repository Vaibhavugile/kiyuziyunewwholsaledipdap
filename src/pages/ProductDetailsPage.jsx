import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { collection, collectionGroup, doc, getDoc, getDocs, limit, query } from "firebase/firestore";
import { db } from "../firebase";
import { useCart, getPriceForQuantity, createStablePricingId } from "../components/CartContext";
import { useAuth } from "../components/AuthContext";
import { FaArrowLeft, FaArrowRight, FaCheck, FaHeart, FaMinus, FaPlus, FaShoppingBag, FaShieldAlt, FaTruck, FaUndo, FaShareAlt, FaCopy } from "react-icons/fa";
import "./ProductDetailsPage.css";

const money = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }) : "";
};
const num = (...values) => {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "" && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
};
const brandForShare = (product = {}) => product.vendor || product.brandName || "Tanishka";
const slugify = (value = "") => String(value).toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
const galleryFor = (p = {}) => [...new Set([
  p.image, p.imageUrl, p.imageURL, ...(Array.isArray(p.imageUrls) ? p.imageUrls : []),
  ...(Array.isArray(p.additionalImages) ? p.additionalImages : []), ...(Array.isArray(p.images) ? p.images : [])
].filter((x) => typeof x === "string" && x.trim()))];

function priceFor(product, subcollection, pricingKey) {
  const tiers = subcollection?.tieredPricing || product?.tieredPricing || product?.commercialData?.tieredPricing;
  const role = tiers?.[pricingKey];
  if (Array.isArray(role) && role.length) {
    const price = getPriceForQuantity(role, 1);
    if (Number.isFinite(Number(price))) return Number(price);
  }
  return num(product?.retailPrice, product?.sellingPrice, product?.salePrice, product?.price,
    subcollection?.retailPrice, subcollection?.sellingPrice, subcollection?.salePrice, subcollection?.price);
}

export default function ProductDetailsPage() {
  const { slug, collectionId, subcollectionId, productId } = useParams();
  const navigate = useNavigate();
  const { cart, addToCart, pricingKey } = useCart();
  const { currentUser } = useAuth();
  const [product, setProduct] = useState(null);
  const [subcollection, setSubcollection] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeImage, setActiveImage] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [wishlisted, setWishlisted] = useState(false);
  const [activeTab, setActiveTab] = useState("details");
  const [similarProducts, setSimilarProducts] = useState([]);
  const [similarLoading, setSimilarLoading] = useState(true);
  const [shareStatus, setShareStatus] = useState("");

  useEffect(() => { window.scrollTo({ top: 0, behavior: "auto" }); }, [slug, productId]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true); setError("");
      try {
        const productRef = doc(db, "collections", collectionId, "subcollections", subcollectionId, "products", productId);
        const [productSnap, subSnap] = await Promise.all([
          getDoc(productRef),
          getDoc(doc(db, "collections", collectionId, "subcollections", subcollectionId))
        ]);
        if (!productSnap.exists()) throw new Error("This product could not be found.");
        const p = { id: productSnap.id, ...productSnap.data(), collectionId, subcollectionId };
        if (!cancelled) {
          setProduct(p);
          setSubcollection(subSnap.exists() ? { id: subSnap.id, ...subSnap.data() } : null);
          setActiveImage(0);
          document.title = `${p.productName || p.name || "Product"} | Tanishka`;
          if (slug && slugify(p.productName || p.name) !== slug) {
            // Keep the supplied canonical product-name slug; data loading remains ID-based.
          }
        }
      } catch (e) {
        if (!cancelled) setError(e.message || "Unable to load product details.");
      } finally { if (!cancelled) setLoading(false); }
    }
    if (collectionId && subcollectionId && productId) load();
    else { setError("Product link is incomplete."); setLoading(false); }
    return () => { cancelled = true; };
  }, [collectionId, subcollectionId, productId, slug]);

  useEffect(() => {
    let cancelled = false;
    async function loadSimilarProducts() {
      if (!collectionId || !subcollectionId || !productId) return;
      setSimilarLoading(true);
      try {
        const found = new Map();
        // First try products in the same subcollection for the most relevant matches.
        const sameRef = collection(db, "collections", collectionId, "subcollections", subcollectionId, "products");
        const sameSnap = await getDocs(query(sameRef, limit(35)));
        sameSnap.forEach((snap) => {
          if (snap.id === productId) return;
          const data = snap.data();
          if (data.available === false || data.status === "inactive") return;
          found.set(snap.id, { id: snap.id, ...data, collectionId, subcollectionId });
        });

        // If the current subcollection has fewer than five alternatives, search other product subcollections too.
        if (found.size < 5) {
          try {
            const allSnap = await getDocs(query(collectionGroup(db, "products"), limit(100)));
            allSnap.forEach((snap) => {
              if (snap.id === productId || found.has(snap.id)) return;
              const data = snap.data();
              if (data.available === false || data.status === "inactive") return;
              const parentSubcollection = snap.ref.parent?.parent;
              const parentCollection = parentSubcollection?.parent?.parent;
              if (!parentSubcollection || !parentCollection) return;
              found.set(snap.id, {
                id: snap.id,
                ...data,
                collectionId: parentCollection.id,
                subcollectionId: parentSubcollection.id,
              });
            });
          } catch (fallbackError) {
            console.warn("Cross-collection related product lookup was unavailable.", fallbackError);
          }
        }

        const currentTags = new Set((Array.isArray(product?.tags) ? product.tags : []).map((tag) => String(tag).toLowerCase()));
        const currentType = String(product?.productType || "").toLowerCase();
        const currentVendor = String(product?.vendor || product?.brandName || "").toLowerCase();
        const ranked = [...found.values()].map((item) => {
          const tags = Array.isArray(item.tags) ? item.tags.map((tag) => String(tag).toLowerCase()) : [];
          const sharedTags = tags.filter((tag) => currentTags.has(tag)).length;
          const typeMatch = currentType && String(item.productType || "").toLowerCase() === currentType ? 3 : 0;
          const vendorMatch = currentVendor && String(item.vendor || item.brandName || "").toLowerCase() === currentVendor ? 2 : 0;
          const sameSubcollection = item.subcollectionId === subcollectionId ? 4 : 0;
          return { ...item, _similarity: sharedTags * 2 + typeMatch + vendorMatch + sameSubcollection };
        }).sort((a, b) => b._similarity - a._similarity).slice(0, 8);

        if (!cancelled) setSimilarProducts(ranked);
      } catch (e) {
        console.warn("Unable to load similar products.", e);
        if (!cancelled) setSimilarProducts([]);
      } finally {
        if (!cancelled) setSimilarLoading(false);
      }
    }
    loadSimilarProducts();
    return () => { cancelled = true; };
  }, [collectionId, subcollectionId, productId, product?.id]);

  useEffect(() => {
    if (!product || typeof document === "undefined") return;
    const title = product.productName || product.name || product.title || "Product";
    const description = String(product.descriptionText || product.description || `${title} from Tanishka.`).replace(/\s+/g, " ").trim().slice(0, 300);
    const image = galleryFor(product)[0] || "";
    const url = window.location.href;
    document.title = `${title} | Tanishka`;
    const upsertMeta = (key, value, property = false) => {
      if (!value) return;
      const attr = property ? "property" : "name";
      let tag = document.head.querySelector(`meta[${attr}="${key}"]`);
      if (!tag) {
        tag = document.createElement("meta");
        tag.setAttribute(attr, key);
        document.head.appendChild(tag);
      }
      tag.setAttribute("content", value);
    };
    upsertMeta("description", description);
    upsertMeta("og:type", "product", true);
    upsertMeta("og:title", title, true);
    upsertMeta("og:description", description, true);
    upsertMeta("og:url", url, true);
    upsertMeta("og:site_name", "Tanishka", true);
    upsertMeta("og:image", image, true);
    const metadataPrice = num(product.retailPrice, product.sellingPrice, product.salePrice, product.price);
    upsertMeta("product:price:amount", metadataPrice !== null ? String(metadataPrice) : "", true);
    upsertMeta("product:price:currency", "INR", true);
    upsertMeta("twitter:card", "summary_large_image");
    upsertMeta("twitter:title", title);
    upsertMeta("twitter:description", description);
    upsertMeta("twitter:image", image);
    let canonical = document.head.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = url;
  }, [product]);

  const gallery = useMemo(() => galleryFor(product || {}), [product]);
  const price = product ? priceFor(product, subcollection, pricingKey || "retail") : null;
  const compareAt = product ? num(product.compareAtPrice, product.compare_at_price, product?.scrapedVariants?.[0]?.compareAtPrice) : null;
  const discount = price > 0 && compareAt > price ? Math.round((compareAt - price) / compareAt * 100) : num(product?.discountPercentage);
  const savings = price !== null && compareAt !== null && compareAt > price ? compareAt - price : null;
  const stock = product ? num(product.current_stock, product.quantity, product.stock, subcollection?.current_stock, subcollection?.quantity) : null;
  const inventoryTracked = product?.trackInventory === true || product?.track_inventory === "yes" || subcollection?.trackInventory === true || subcollection?.track_inventory === "yes";
  const unavailable = product?.available === false || product?.status === "inactive" || (inventoryTracked && stock !== null && stock <= 0);
  const tierData = subcollection?.tieredPricing || product?.tieredPricing || (price !== null ? { [pricingKey || "retail"]: [{ min_quantity: 1, max_quantity: 999999, price }] } : null);
  const roleTiers = tierData?.[pricingKey || "retail"];
  const stablePricingId = roleTiers?.length ? createStablePricingId(roleTiers) : null;
  const cartQty = Object.values(cart || {}).reduce((total, item) => {
    if (item?.id === product?.id && item?.subcollectionId === subcollectionId) return total + Number(item.quantity || item.qty || 0);
    return total;
  }, 0);

  const add = () => {
    if (!currentUser) { navigate("/login"); return; }
    if (!product || unavailable || !tierData?.[pricingKey || "retail"]?.length) return;
    const payload = {
      id: product.id, productName: product.productName || product.name, productCode: product.productCode,
      image: gallery[0] || product.image, imageUrls: gallery, additionalImages: product.additionalImages || [],
      tieredPricing: tierData, subcollectionId, collectionId, pricingId: stablePricingId, variation: null
    };
    for (let i = 0; i < quantity; i++) addToCart(payload);
  };

  const shareProduct = async () => {
    if (!product) return;
    const shareUrl = window.location.href;
    const shareTitle = product.productName || product.name || product.title || "Tanishka product";
    const shareDescription = String(product.descriptionText || product.description || "").replace(/\s+/g, " ").trim().slice(0, 240);
    const sharePrice = price !== null ? `Price: ${money(price)}` : "Price available on product page";
    const shareTags = Array.isArray(product.tags) ? product.tags.filter((tag) => typeof tag === "string").slice(0, 8).join(", ") : "";
    const shareText = [shareTitle, brandForShare(product), sharePrice, shareDescription, shareTags ? `Tags: ${shareTags}` : "", shareUrl].filter(Boolean).join("\n\n");
    try {
      if (navigator.share) {
        await navigator.share({ title: shareTitle, text: shareText, url: shareUrl });
        setShareStatus("Share sheet opened");
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareText);
        setShareStatus("Product link and details copied");
      } else {
        window.prompt("Copy product link and details:", shareText);
        setShareStatus("Copy the product details from the prompt");
      }
    } catch (e) {
      if (e?.name !== "AbortError") setShareStatus("Unable to share right now");
    }
    window.setTimeout(() => setShareStatus(""), 3000);
  };

  if (loading) return <main className="tpd-page"><div className="tpd-loading"><span className="tpd-loader" />Curating your product details…</div></main>;
  if (error || !product) return <main className="tpd-page"><div className="tpd-error"><h1>We couldn’t find this product</h1><p>{error}</p><Link to="/collections">Explore collections</Link></div></main>;

  const title = product.productName || product.name || product.title || "Product";
  const brand = product.vendor || product.brandName || "";
  const description = product.descriptionText || product.description || "";
  const features = Array.isArray(product.keyFeatures) ? product.keyFeatures : [];
  const tags = Array.isArray(product.tags) ? product.tags.filter(t => typeof t === "string" && t.length < 48 && !/^(true|false)$/i.test(t)) : [];
  const currentTierPrice = price;

  return (
    <main className="tpd-page">
      <div className="tpd-shell">
        <nav className="tpd-breadcrumb" aria-label="Breadcrumb">
          <button type="button" onClick={() => navigate(-1)}><FaArrowLeft /> Back</button>
          <span>/</span><Link to="/collections">Collections</Link><span>/</span><span>{title}</span>
        </nav>

        <section className="tpd-product-layout">
          <div className="tpd-gallery-column">
            <div className="tpd-main-image-wrap">
              <div className="tpd-image-label">TANISHKA EDIT</div>
              {discount > 0 && <div className="tpd-discount"><small>EXCLUSIVE SAVING</small><strong>SAVE {Math.round(discount)}%</strong></div>}
              {gallery.length ? <img className="tpd-main-image" src={gallery[activeImage] || gallery[0]} alt={title} onError={(e) => { e.currentTarget.style.opacity = ".15"; }} /> :
                <div className="tpd-no-image"><span>✧</span><small>Image coming soon</small></div>}
              {gallery.length > 1 && <>
                <button className="tpd-gallery-nav prev" type="button" aria-label="Previous image" onClick={() => setActiveImage(i => (i - 1 + gallery.length) % gallery.length)}><FaArrowLeft /></button>
                <button className="tpd-gallery-nav next" type="button" aria-label="Next image" onClick={() => setActiveImage(i => (i + 1) % gallery.length)}><FaArrowRight /></button>
                <span className="tpd-image-count">{activeImage + 1} / {gallery.length}</span>
              </>}
              <button className={`tpd-wishlist${wishlisted ? " active" : ""}`} type="button" aria-label="Add to wishlist" onClick={() => setWishlisted(v => !v)}><FaHeart /></button>
            </div>
            {gallery.length > 1 && <div className="tpd-thumbnails" aria-label="Product images">
              {gallery.map((src, index) => <button key={`${src}-${index}`} className={index === activeImage ? "active" : ""} type="button" onClick={() => setActiveImage(index)} aria-label={`View image ${index + 1}`}><img src={src} alt={`${title} view ${index + 1}`} loading="lazy" /></button>)}
            </div>}
            <div className="tpd-trust-strip">
              <div><FaShieldAlt /><span><b>Quality picks</b><small>Thoughtfully selected</small></span></div>
              <div><FaTruck /><span><b>Delivery</b><small>Across India</small></span></div>
              <div><FaUndo /><span><b>Easy support</b><small>Here to help</small></span></div>
            </div>
          </div>

          <div className="tpd-info">
            <div className="tpd-title-tools">
              <div className="tpd-eyebrow">{brand ? brand.toUpperCase() : "TANISHKA COLLECTION"}{product.productCode ? <span>DESIGN {product.productCode}</span> : null}</div>
              <button className="tpd-share-button" type="button" onClick={shareProduct} aria-label="Share product with details"><FaShareAlt /> <span>Share product</span></button>
            </div>
            {shareStatus && <p className="tpd-share-status" role="status"><FaCopy /> {shareStatus}</p>}
            <h1>{title}</h1>
            {product.productType && <p className="tpd-product-type">{product.productType}</p>}
            <div className="tpd-rating-note"><span className="tpd-stars">✦ ✦ ✦ ✦ ✦</span><span>Curated for your everyday favourites</span></div>

            <div className="tpd-price-card">
              <div className="tpd-price-heading"><span>Your price</span>{savings !== null && <span className="tpd-save-pill">YOU SAVE {money(savings)}</span>}</div>
              <div className="tpd-price-row">
                <strong>{price !== null ? money(price) : "Price on request"}</strong>
                {compareAt !== null && price !== null && compareAt > price && <del>{money(compareAt)}</del>}
                {discount > 0 && <span className="tpd-price-discount">{Math.round(discount)}% OFF</span>}
              </div>
              {savings !== null && <p className="tpd-savings-line"><b>✦ Save {money(savings)}</b><span> compared with the reference price</span></p>}
              {product.gstRate !== undefined && <small className="tpd-tax-note">GST {product.gstRate}% {product.gstType ? `· ${product.gstType}` : ""}</small>}
            </div>

            <div className="tpd-stock-row">
              <span className={`tpd-stock-dot${unavailable ? " out" : ""}`} />
              <b>{unavailable ? "Currently unavailable" : stock !== null ? `${stock > 0 ? `${stock} available` : "Out of stock"}` : "Available to order"}</b>
              {product.unit && product.unit !== "No" && <span>· Sold by {product.unit}</span>}
            </div>

            <p className="tpd-description-intro">{description || "Discover the details, features and product information below."}</p>

            <div className="tpd-buy-row">
              <div className="tpd-quantity-picker"><button type="button" aria-label="Decrease quantity" disabled={quantity <= 1} onClick={() => setQuantity(q => Math.max(1, q - 1))}><FaMinus /></button><span>{quantity}</span><button type="button" aria-label="Increase quantity" disabled={unavailable || (inventoryTracked && stock !== null && quantity >= stock)} onClick={() => setQuantity(q => q + 1)}><FaPlus /></button></div>
              <button className="tpd-add-button" type="button" disabled={unavailable || price === null} onClick={add}><FaShoppingBag /> {cartQty > 0 ? `Add more · ${cartQty} in bag` : "Add to bag"} <FaArrowRight /></button>
            </div>
            {!currentUser && <p className="tpd-login-note">Sign in to add items to your bag.</p>}
            <div className="tpd-assurance"><FaCheck /> Secure checkout <span>•</span> Pricing for your account tier</div>

            <div className="tpd-detail-tabs" role="tablist">
              <button type="button" className={activeTab === "details" ? "active" : ""} onClick={() => setActiveTab("details")}>Details</button>
              <button type="button" className={activeTab === "features" ? "active" : ""} onClick={() => setActiveTab("features")}>Key features ({features.length})</button>
              <button type="button" className={activeTab === "shipping" ? "active" : ""} onClick={() => setActiveTab("shipping")}>Product info</button>
            </div>
            <div className="tpd-tab-content">
              {activeTab === "details" && <><h3>About this product</h3>{product.descriptionHtml ? <div className="tpd-rich-description" dangerouslySetInnerHTML={{ __html: product.descriptionHtml }} /> : <p>{description || "Product details will be updated soon."}</p>}</>}
              {activeTab === "features" && (features.length ? <ul className="tpd-feature-list">{features.map((feature, i) => <li key={`${i}-${feature}`}><FaCheck /><span>{feature}</span></li>)}</ul> : <p>Feature information is not available for this product yet.</p>)}
              {activeTab === "shipping" && <div className="tpd-spec-grid">
                {[
                  ["Product code", product.productCode], ["Brand", brand], ["Product type", product.productType],
                  ["Unit", product.unit], ["Origin", product.origin], ["SKU", product.sku || product.scrapedVariants?.[0]?.sku],
                  ["GST rate", product.gstRate !== undefined ? `${product.gstRate}%` : null],
                  ["GST type", product.gstType], ["Availability", product.available === false ? "Unavailable" : "Available"],
                ].filter(([, value]) => value !== undefined && value !== null && value !== "").map(([label, value]) => <div key={label}><small>{label}</small><b>{String(value)}</b></div>)}
              </div>}
            </div>
            {tags.length > 0 && <div className="tpd-tags"><span>Explore tags</span>{tags.slice(0, 8).map(tag => <span key={tag}>{tag}</span>)}</div>}
          </div>
        </section>
        {Array.isArray(product.faqs) && product.faqs.filter(f => f?.question && f?.answer && !["shop by", "share", "description"].includes(String(f.question).toLowerCase())).length > 0 && (
          <section className="tpd-faq-section"><p className="tpd-eyebrow">NEED TO KNOW</p><h2>Frequently asked questions</h2>
            <div className="tpd-faq-grid">{product.faqs.filter(f => f?.question && f?.answer && !["shop by", "share", "description"].includes(String(f.question).toLowerCase())).slice(0, 8).map((faq, i) => <details key={`${faq.question}-${i}`}><summary>{faq.question}</summary><p>{faq.answer}</p></details>)}</div>
          </section>
        )}
        <section className="tpd-similar-section">
          <p className="tpd-eyebrow">CURATED FOR YOU</p>
          <h2>You may also like</h2>
          <p className="tpd-similar-intro">Explore more picks with similar styles, categories and tags.</p>
          {similarLoading ? (
            <div className="tpd-similar-loading">Finding more favourites…</div>
          ) : similarProducts.length ? (
            <div className="tpd-similar-grid">
              {similarProducts.map((item) => {
                const itemTitle = item.productName || item.name || item.title || "Product";
                const itemImage = galleryFor(item)[0];
                const itemPrice = priceFor(item, null, pricingKey || "retail");
                const itemCompare = num(item.compareAtPrice, item.compare_at_price);
                const itemSlug = slugify(itemTitle);
                return (
                  <Link
                    className="tpd-similar-card"
                    key={`${item.collectionId}-${item.subcollectionId}-${item.id}`}
                    to={`/product/${itemSlug}/${encodeURIComponent(item.collectionId)}/${encodeURIComponent(item.subcollectionId)}/${encodeURIComponent(item.id)}`}
                    onClick={() => window.scrollTo({ top: 0, behavior: "auto" })}
                  >
                    <div className="tpd-similar-image">
                      {itemImage ? <img src={itemImage} alt={itemTitle} loading="lazy" /> : <span>✧</span>}
                      {itemCompare !== null && itemPrice !== null && itemCompare > itemPrice && <small>{Math.round((itemCompare - itemPrice) / itemCompare * 100)}% OFF</small>}
                    </div>
                    <div className="tpd-similar-copy">
                      <span>{item.vendor || item.brandName || item.productType || "Tanishka edit"}</span>
                      <h3>{itemTitle}</h3>
                      <div>{itemPrice !== null ? <strong>{money(itemPrice)}</strong> : <strong>View price</strong>}{itemCompare !== null && itemPrice !== null && itemCompare > itemPrice && <del>{money(itemCompare)}</del>}</div>
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <p className="tpd-similar-empty">More products are coming soon.</p>
          )}
        </section>
      </div>
    </main>
  );
}
