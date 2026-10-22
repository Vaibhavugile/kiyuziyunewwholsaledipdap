import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collectionGroup, doc, getDoc, getDocs, limit, query } from 'firebase/firestore';
import { db } from '../firebase';
import ProductCard from './ProductCard';
import { useCart, createStablePricingId } from './CartContext';
import { STARTER_HOMEPAGE_SECTIONS } from './homepageSectionsConfig';
import { getProductsForSection, normalizeProductDocument, productImage, productPrice } from './homepageProductUtils';
import './HomepageSections.css';

const SECTION_CONFIG_PATH = ['homepageConfig', 'sections'];

async function loadSectionConfig() {
  const ref = doc(db, ...SECTION_CONFIG_PATH);
  const snap = await getDoc(ref);
  if (!snap.exists() || !Array.isArray(snap.data().sections)) return STARTER_HOMEPAGE_SECTIONS;
  return snap.data().sections;
}

async function loadHomepageProducts() {
  // Product documents are stored under:
  // collections/{collectionId}/subcollections/{subcollectionId}/products/{productId}
  // collectionGroup lets homepage sections span every collection/subcollection.
  const q = query(collectionGroup(db, 'products'), limit(1000));
  const snap = await getDocs(q);
  const products = snap.docs.map(normalizeProductDocument);

  // In this store, price tiers and inventory can live on the parent subcollection
  // document rather than the product document. Fetch each unique parent once.
  const parentKeys = [...new Set(products
    .filter((p) => p.collectionId && p.subcollectionId)
    .map((p) => `${p.collectionId}__${p.subcollectionId}`))];
  const parentEntries = await Promise.all(parentKeys.map(async (key) => {
    const splitAt = key.indexOf('__');
    const collectionId = key.slice(0, splitAt);
    const subcollectionId = key.slice(splitAt + 2);
    try {
      const parentSnap = await getDoc(doc(db, 'collections', collectionId, 'subcollections', subcollectionId));
      return [key, parentSnap.exists() ? parentSnap.data() : {}];
    } catch (error) {
      console.warn('Could not load subcollection pricing for homepage', key, error);
      return [key, {}];
    }
  }));
  const parents = new Map(parentEntries);
  return products.map((p) => {
    const parent = parents.get(`${p.collectionId}__${p.subcollectionId}`) || {};
    return {
      ...p,
      _subcollectionData: parent,
      tieredPricing: p.tieredPricing || parent.tieredPricing,
      retailPrice: p.retailPrice ?? parent.retailPrice,
      sellingPrice: p.sellingPrice ?? parent.sellingPrice,
      salePrice: p.salePrice ?? parent.salePrice,
      price: p.price ?? parent.price,
      quantity: p.quantity ?? parent.quantity,
      current_stock: p.current_stock ?? parent.current_stock,
      trackInventory: p.trackInventory ?? parent.trackInventory,
    };
  });
}

const slugify = (value = '') => String(value).toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'product';

function productDetailsUrl(product) {
  const collectionId = product.collectionId || product.mainCollection || '';
  const subcollectionId = product.subcollectionId || '';
  const productId = product.id || product.productId || '';
  if (!collectionId || !subcollectionId || !productId) return '/products';
  return `/product/${slugify(product.productName || product.title || product.name)}/${encodeURIComponent(collectionId)}/${encodeURIComponent(subcollectionId)}/${encodeURIComponent(productId)}`;
}

function SectionHeading({ section, onViewAll }) {
  return (
    <div className="tanishka-home-section__heading">
      <div className="tanishka-home-section__heading-copy">
        {section.badge && <span className={`tanishka-home-section__eyebrow is-${section.accent || 'gold'}`}>{section.badge}</span>}
        <h2>{section.title}</h2>
        {section.subtitle && <p>{section.subtitle}</p>}
      </div>
      {section.showViewAll !== false && (
        <button type="button" className="tanishka-home-section__view-all" onClick={onViewAll}>
          View all <span aria-hidden="true">↗</span>
        </button>
      )}
    </div>
  );
}

function MiniProductCard({ product, onClick }) {
  const image = productImage(product);
  const price = productPrice(product);
  const compare = Number(product.compareAtPrice ?? product.compare_at_price ?? 0);
  const title = product.productName || product.title || product.name || 'Product';
  const discount = price > 0 && compare > price ? Math.round((compare - price) / compare * 100) : Number(product.discountPercentage || 0);
  return (
    <button className="tanishka-mini-product" type="button" onClick={onClick}>
      <span className="tanishka-mini-product__image-wrap">
        {discount > 0 && <span className="tanishka-mini-product__discount">-{Math.round(discount)}%</span>}
        {image ? <img src={image} alt={title} loading="lazy" /> : <span className="tanishka-mini-product__placeholder">✧</span>}
      </span>
      <span className="tanishka-mini-product__title">{title}</span>
      <span className="tanishka-mini-product__price-row">
        <strong>{price !== null ? `₹${Number(price).toLocaleString('en-IN')}` : 'View price'}</strong>
        {price > 0 && compare > price && <del>₹{compare.toLocaleString('en-IN')}</del>}
      </span>
    </button>
  );
}

export default function HomepageSections({
  sections: providedSections,
  products: providedProducts,
  onIncrement,
  onDecrement,
  cart: providedCart,
  pricingKey: providedPricingKey,
  onSectionViewAll,
  renderProductCard = true,
}) {
  const navigate = useNavigate();
  const cartContext = useCart();
  const cart = providedCart ?? cartContext.cart ?? [];
  const pricingKey = providedPricingKey || cartContext.pricingKey || 'retail';
  const [sections, setSections] = useState(providedSections || []);
  const [products, setProducts] = useState(providedProducts || []);
  const [loading, setLoading] = useState(!providedSections || !providedProducts);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (providedSections && providedProducts) {
        setSections(providedSections);
        setProducts(providedProducts);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError('');
      const results = await Promise.allSettled([
        providedSections ? Promise.resolve(providedSections) : loadSectionConfig(),
        providedProducts ? Promise.resolve(providedProducts) : loadHomepageProducts(),
      ]);
      if (cancelled) return;
      const sectionResult = results[0];
      const productResult = results[1];
      if (sectionResult.status === 'fulfilled') setSections(sectionResult.value || STARTER_HOMEPAGE_SECTIONS);
      else setSections(STARTER_HOMEPAGE_SECTIONS);
      if (productResult.status === 'fulfilled') setProducts(productResult.value || []);
      else {
        setProducts([]);
        setError('We could not load homepage products. Check Firestore read permissions and the products collection-group query.');
      }
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [providedSections, providedProducts]);

  const activeSections = useMemo(() => [...(sections || [])]
    .filter((section) => section.active !== false)
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0)), [sections]);

  const sectionProducts = useMemo(() => {
    const result = {};
    activeSections.forEach((section) => {
      result[section.id] = getProductsForSection(products, section, { pricingKey }).map((product) => ({
        ...product,
        calculatedPrice: productPrice({ ...product, pricingKey }),
      }));
    });
    return result;
  }, [activeSections, products, pricingKey]);

  const handleHomepageAddToCart = (product, variation) => {
    if (onIncrement) {
      onIncrement(product, variation);
      return;
    }

    const subcollection = product._subcollectionData || {};
    const directPrice = productPrice({ ...product, pricingKey });
    const tieredPricingData = subcollection.tieredPricing || product.tieredPricing || (
      directPrice !== null ? { [pricingKey]: [{ min_quantity: 1, max_quantity: 999999, price: directPrice }] } : null
    );
    const roleBasedTiers = tieredPricingData?.[pricingKey];
    if (!roleBasedTiers?.length) {
      window.alert('Price information is not available for this product yet.');
      return;
    }

    const productData = {
      ...product,
      id: product.id,
      productName: product.productName || product.title || product.name,
      productCode: product.productCode,
      image: product.image || product.imageUrl || productImage(product),
      tieredPricing: tieredPricingData,
      subcollectionId: product.subcollectionId,
      collectionId: product.collectionId || product.mainCollection,
      pricingId: createStablePricingId(roleBasedTiers),
      variation: variation || product.variation,
    };
    // CartContext uses productData.quantity as its stock limit before removing
    // quantity from the stored cart item, matching the existing listing flow.
    cartContext.addToCart(productData);
  };

  const goToSectionListing = (section) => {
    if (onSectionViewAll) return onSectionViewAll(section, sectionProducts[section.id] || []);
    // The existing store's known listing route is collection-scoped. Use the
    // first matching product's collection rather than linking to an assumed route.
    const firstProduct = sectionProducts[section.id]?.[0];
    const collectionId = firstProduct?.collectionId || firstProduct?.mainCollection;
    if (collectionId) {
      navigate(`/collections/${encodeURIComponent(collectionId)}/all-products`);
    } else {
      const params = new URLSearchParams({ section: section.id, type: section.type });
      navigate(`/collections?${params.toString()}`);
    }
  };

  if (loading) {
    return <div className="tanishka-home-sections__loading" aria-live="polite"><span className="tanishka-home-sections__spinner" /> Curating your finds…</div>;
  }

  return (
    <div className="tanishka-home-sections">
      {error && <div className="tanishka-home-sections__notice" role="status">{error}</div>}
      {activeSections.map((section) => {
        const items = sectionProducts[section.id] || [];
        if (!items.length && section.hideWhenEmpty !== false) return null;
        return (
          <section key={section.id} className={`tanishka-home-section is-${section.accent || 'gold'}`}>
            <SectionHeading section={section} onViewAll={() => goToSectionListing(section)} />
            {items.length ? (
              <>
                {renderProductCard ? (
                  <div className="tanishka-home-section__product-grid">
                    {items.map((product) => (
                      <div className="tanishka-home-section__product" key={`${product.collectionId}-${product.subcollectionId}-${product.id}`}>
                        <ProductCard
                          product={product}
                          cart={cart}
                          onIncrement={handleHomepageAddToCart}
                          onDecrement={onDecrement || cartContext.removeFromCart}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="tanishka-home-section__mini-grid">
                    {items.map((product) => (
                      <MiniProductCard key={`${product.collectionId}-${product.subcollectionId}-${product.id}`} product={product} onClick={() => navigate(productDetailsUrl(product))} />
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="tanishka-home-section__empty">Products will appear here when they match this collection.</div>
            )}
          </section>
        );
      })}
      {!activeSections.length && <div className="tanishka-home-sections__notice">No homepage sections are active yet. Add sections in the homepage admin panel.</div>}
    </div>
  );
}
