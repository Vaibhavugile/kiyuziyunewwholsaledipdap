/**
 * Firestore document: homepageConfig/sections
 * { sections: HomepageSection[], updatedAt: serverTimestamp() }
 *
 * Section types:
 * price_range | tag | category | featured | new_arrivals | best_sellers
 */
export const STARTER_HOMEPAGE_SECTIONS = [
  {
    id: 'under-9', title: 'Under ₹9', subtitle: 'Tiny prices. Smart finds.', type: 'price_range',
    active: true, sortOrder: 1, productLimit: 10, minPrice: 0, maxPrice: 9,
    sortBy: 'price-asc', showViewAll: true, badge: 'BUDGET PICKS', accent: 'gold',
  },
  {
    id: 'under-49', title: 'Under ₹49', subtitle: 'Little things you will love.', type: 'price_range',
    active: true, sortOrder: 2, productLimit: 10, minPrice: 0, maxPrice: 49,
    sortBy: 'price-asc', showViewAll: true, badge: 'HOT DEALS', accent: 'maroon',
  },
  {
    id: 'under-99', title: 'Under ₹99', subtitle: 'Great finds, even better prices.', type: 'price_range',
    active: true, sortOrder: 3, productLimit: 10, minPrice: 0, maxPrice: 99,
    sortBy: 'discount-desc', showViewAll: true, badge: 'MOST LOVED', accent: 'gold',
  },
  {
    id: 'festival-specials', title: 'Festival Specials', subtitle: 'Thoughtful finds for every celebration.', type: 'tag',
    active: true, sortOrder: 4, productLimit: 10, tags: ['Navratri'], productIds: [],
    matchMode: 'any', sortBy: 'discount-desc', showViewAll: true, badge: 'FESTIVE EDIT', accent: 'maroon',
  },
  {
    id: 'mega-savings', title: 'Mega Savings', subtitle: 'Big discounts on everyday essentials.', type: 'tag',
    active: true, sortOrder: 5, productLimit: 10, tags: ['ff sale', 'collection_mega_savings', 'mega savings', 'sale', 'offer'],
    matchMode: 'any', sortBy: 'discount-desc', showViewAll: true, badge: 'LIMITED DEALS', accent: 'gold',
  },
  {
    id: 'new-arrivals', title: 'Fresh Finds', subtitle: 'Recently added to the collection.', type: 'new_arrivals',
    active: true, sortOrder: 6, productLimit: 10, sortBy: 'newest', showViewAll: true, badge: 'JUST IN', accent: 'maroon',
  },
  {
    id: 'featured-finds', title: 'Handpicked for You', subtitle: 'A few favourites from Tanishka.', type: 'featured',
    active: true, sortOrder: 7, productLimit: 10, productIds: [], sortBy: 'discount-desc',
    showViewAll: true, badge: 'EDITOR’S PICKS', accent: 'gold',
  },
];

export const HOMEPAGE_SECTIONS_DOC = { collection: 'homepageConfig', document: 'sections' };
