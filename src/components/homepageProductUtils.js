export const toNumber = (...values) => {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
};

export const productPrice = (product = {}) => {
  // Prefer the active customer's role-based tier over a generic retail price.
  const tiers = product.tieredPricing || product.commercialData?.tieredPricing || product._subcollectionData?.tieredPricing || {};
  const role = product.pricingKey || 'retail';
  const selected = Array.isArray(tiers[role])
    ? tiers[role]
    : null;
  if (selected?.length) {
    const first = [...selected].sort((a, b) =>
      Number(a.min_quantity ?? a.minQuantity ?? 1) - Number(b.min_quantity ?? b.minQuantity ?? 1)
    )[0];
    const tierPrice = toNumber(first.price, first.rate, first.unitPrice);
    if (tierPrice !== null && tierPrice > 0) return tierPrice;
  }

  return toNumber(
    product.retailPrice,
    product.sellingPrice,
    product.salePrice,
    product.price,
    product.commercialData?.retailPrice,
    product.commercialData?.sellingPrice,
    product.commercialData?.salePrice,
    product.commercialData?.price,
    product._subcollectionData?.retailPrice,
    product._subcollectionData?.sellingPrice,
    product._subcollectionData?.salePrice,
    product._subcollectionData?.price,
    product.calculatedPrice,
  );
};

export const productStock = (p = {}) => toNumber(
  p.quantity, p.current_stock, p.stock,
  p.commercialData?.quantity, p.commercialData?.current_stock,
  p._subcollectionData?.quantity, p._subcollectionData?.current_stock,
);

export const productTags = (p = {}) => {
  const raw = p.tags ?? p.tag ?? p.productTags ?? [];
  const values = Array.isArray(raw) ? raw : String(raw).split(/[,|]/);
  return values.map((x) => String(x).trim().toLowerCase()).filter(Boolean);
};

export const productImage = (p = {}) => {
  const all = [p.image, p.imageUrl, p.imageURL, p.thumbnail,
    ...(Array.isArray(p.imageUrls) ? p.imageUrls : []),
    ...(Array.isArray(p.additionalImages) ? p.additionalImages : []),
    ...(Array.isArray(p.images) ? p.images : [])];
  return all.find((x) => typeof x === 'string' && x.trim()) || '';
};

export const productDiscount = (p = {}) => {
  const price = productPrice(p);
  const compare = toNumber(p.compareAtPrice, p.compare_at_price, p.commercialData?.compareAtPrice);
  if (price !== null && compare !== null && compare > price) {
    return Math.round(((compare - price) / compare) * 100);
  }
  const given = toNumber(p.discountPercentage);
  return given && given > 0 ? Math.round(given) : 0;
};

export const isPubliclyAvailable = (p = {}) => {
  if (p.available === false || p.status === 'inactive' || p.status === 'archived') return false;
  const stock = productStock(p);
  const tracks = p.trackInventory === true || p.track_inventory === true || p.commercialData?.trackInventory === true || p._subcollectionData?.trackInventory === true || p._subcollectionData?.track_inventory === true;
  if (tracks && stock !== null && stock <= 0) return false;
  return true;
};

export const normalizeProductDocument = (snap) => {
  const data = snap.data();
  const parts = snap.ref.path.split('/');
  const subIndex = parts.indexOf('subcollections');
  const collectionIndex = parts.indexOf('collections');
  return {
    id: snap.id,
    ...data,
    collectionId: data.collectionId || (collectionIndex >= 0 ? parts[collectionIndex + 1] : data.mainCollection || ''),
    mainCollection: data.mainCollection || (collectionIndex >= 0 ? parts[collectionIndex + 1] : ''),
    subcollectionId: data.subcollectionId || (subIndex >= 0 ? parts[subIndex + 1] : ''),
    _documentPath: snap.ref.path,
  };
};

const searchableText = (p) => [p.productName, p.title, p.name, p.productType, p.vendor, p.brandName,
  p.subcollectionName, p.mainCollectionName, ...productTags(p)].filter(Boolean).join(' ').toLowerCase();

export const getProductsForSection = (allProducts, section, { pricingKey = 'retail' } = {}) => {
  const active = allProducts.filter(isPubliclyAvailable).map((p) => ({ ...p, pricingKey }));
  const tagNeedles = (section.tags || []).map((x) => String(x).toLowerCase().trim()).filter(Boolean);
  const curatedIds = new Set((section.productIds || []).map(String));

  let result = active.filter((p) => {
    const price = productPrice(p);
    const tags = productTags(p);
    const text = searchableText(p);
    switch (section.type) {
      case 'price_range':
        return price !== null && price >= Number(section.minPrice ?? 0) && price <= Number(section.maxPrice ?? Infinity);
      case 'tag': {
        // Tag-driven collection plus optional manually curated product IDs.
        if (curatedIds.has(String(p.id))) return true;
        if (!tagNeedles.length) return false;
        const exact = tags.some((tag) => tagNeedles.some((needle) => tag === needle || tag.includes(needle)));
        const textMatch = tagNeedles.some((needle) => needle && text.includes(needle));
        return section.matchMode === 'all'
          ? tagNeedles.every((needle) => tags.some((tag) => tag === needle || tag.includes(needle)))
          : exact || textMatch;
      }
      case 'category': {
        const category = String(section.category || '').toLowerCase().trim();
        return !!category && [p.productType, p.category, p.mainCollectionName, p.subcollectionName]
          .some((v) => String(v || '').toLowerCase().includes(category));
      }
      case 'featured':
        return curatedIds.size ? curatedIds.has(String(p.id)) : p.featured === true || p.isFeatured === true;
      case 'new_arrivals':
        return !!(p.createdAt || p.created_at || p.scrapedAt || p.scraped_at || p.addedAt || p.added_at);
      case 'best_sellers':
        return Number(p.salesCount ?? p.orderCount ?? p.totalSold ?? p.unitsSold ?? 0) > 0;
      default:
        return false;
    }
  });

  const sortBy = section.sortBy || 'discount-desc';
  result.sort((a, b) => {
    const pa = productPrice(a) ?? Number.POSITIVE_INFINITY;
    const pb = productPrice(b) ?? Number.POSITIVE_INFINITY;
    if (sortBy === 'price-asc') return pa - pb;
    if (sortBy === 'price-desc') return pb - pa;
    if (sortBy === 'discount-desc') return productDiscount(b) - productDiscount(a) || pa - pb;
    if (sortBy === 'newest') {
      const dateA = new Date(a.createdAt?.toDate?.() || a.createdAt || a.created_at || a.scrapedAt || a.scraped_at || 0).getTime();
      const dateB = new Date(b.createdAt?.toDate?.() || b.createdAt || b.created_at || b.scrapedAt || b.scraped_at || 0).getTime();
      return dateB - dateA;
    }
    return 0;
  });

  // Stable de-duplication prevents one product repeating within a section.
  const seen = new Set();
  return result.filter((p) => {
    const key = `${p.collectionId}/${p.subcollectionId}/${p.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, Math.max(1, Math.min(30, Number(section.productLimit) || 10)));
};
