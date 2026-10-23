/**
 * Firestore document: homepageConfig/sections
 * { sections: HomepageSection[], updatedAt: serverTimestamp() }
 *
 * Price sections intentionally include every product category. Prices are read
 * from the same product/subcollection fields used by the existing storefront.
 */
export const STARTER_HOMEPAGE_SECTIONS = [
  { id: 'under-9', title: 'Under ₹9', subtitle: 'Little prices, useful finds.', type: 'price_range', active: true, sortOrder: 1, productLimit: 10, minPrice: 0, maxPrice: 9, sortBy: 'price-asc', showViewAll: true, badge: 'BUDGET PICKS', accent: 'gold' },
  { id: 'under-49', title: 'Under ₹49', subtitle: 'Everyday favourites across all categories.', type: 'price_range', active: true, sortOrder: 2, productLimit: 10, minPrice: 0, maxPrice: 49, sortBy: 'price-asc', showViewAll: true, badge: 'GREAT VALUE', accent: 'maroon' },
  { id: 'under-99', title: 'Under ₹99', subtitle: 'More choices for less.', type: 'price_range', active: true, sortOrder: 3, productLimit: 10, minPrice: 0, maxPrice: 99, sortBy: 'price-asc', showViewAll: true, badge: 'POPULAR PICKS', accent: 'gold' },
  { id: 'under-199', title: 'Under ₹199', subtitle: 'Smart shopping picks for every day.', type: 'price_range', active: true, sortOrder: 4, productLimit: 10, minPrice: 0, maxPrice: 199, sortBy: 'price-asc', showViewAll: true, badge: 'SMART FINDS', accent: 'maroon' },
  { id: 'under-299', title: 'Under ₹299', subtitle: 'Discover something you will love.', type: 'price_range', active: true, sortOrder: 5, productLimit: 10, minPrice: 0, maxPrice: 299, sortBy: 'price-asc', showViewAll: true, badge: 'MORE TO EXPLORE', accent: 'gold' },
  { id: 'under-499', title: 'Under ₹499', subtitle: 'Great finds at friendly prices.', type: 'price_range', active: true, sortOrder: 6, productLimit: 10, minPrice: 0, maxPrice: 499, sortBy: 'price-asc', showViewAll: true, badge: 'VALUE EDIT', accent: 'maroon' },
  { id: 'under-999', title: 'Under ₹999', subtitle: 'Bigger choices, beautiful value.', type: 'price_range', active: true, sortOrder: 7, productLimit: 10, minPrice: 0, maxPrice: 999, sortBy: 'price-asc', showViewAll: true, badge: 'PREMIUM PICKS', accent: 'gold' },
  { id: 'festival-specials', title: 'Festival Specials', subtitle: 'Finds for celebrations and gifting.', type: 'tag', active: true, sortOrder: 8, productLimit: 10, tags: ['Navratri'], productIds: [], matchMode: 'any', sortBy: 'discount-desc', showViewAll: true, badge: 'FESTIVE EDIT', accent: 'maroon' },
  { id: 'mega-savings', title: 'Mega Savings', subtitle: 'Deals across the whole catalogue.', type: 'tag', active: true, sortOrder: 9, productLimit: 10, tags: ['ff sale', 'collection_mega_savings', 'mega savings', 'sale', 'offer'], matchMode: 'any', sortBy: 'discount-desc', showViewAll: true, badge: 'LIMITED DEALS', accent: 'gold' },
  { id: 'new-arrivals', title: 'Fresh Finds', subtitle: 'Recently added to the catalogue.', type: 'new_arrivals', active: true, sortOrder: 10, productLimit: 10, sortBy: 'newest', showViewAll: true, badge: 'JUST IN', accent: 'maroon' },
  { id: 'featured-finds', title: 'Handpicked for You', subtitle: 'A few favourites from Tanishka.', type: 'featured', active: true, sortOrder: 11, productLimit: 10, productIds: [], sortBy: 'discount-desc', showViewAll: true, badge: 'EDITOR’S PICKS', accent: 'gold' },
];

export const HOMEPAGE_SECTIONS_DOC = { collection: 'homepageConfig', document: 'sections' };
