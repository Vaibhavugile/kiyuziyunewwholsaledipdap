
import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import './ProductCard.css';

const asNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;

  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

const formatINR = (value) =>
  `₹${Number(value).toLocaleString('en-IN', {
    maximumFractionDigits: 2,
    minimumFractionDigits: Number(value) % 1 === 0 ? 0 : 2,
  })}`;

const readStock = (product) => {
  const candidates = [
    product?.quantity,
    product?.current_stock,
    product?.stock,
    product?.commercialData?.quantity,
    product?.commercialData?.current_stock,
  ];

  for (const value of candidates) {
    const n = asNumber(value);
    if (n !== null) return n;
  }

  return null;
};

const getPrice = (product) => {
  const direct = [
    product?.calculatedPrice,
    product?.retailPrice,
    product?.sellingPrice,
    product?.salePrice,
    product?.price,
    product?.commercialData?.retailPrice,
    product?.commercialData?.sellingPrice,
  ];

  for (const value of direct) {
    const n = asNumber(value);
    if (n !== null && n > 0) return n;
  }

  const tiers = product?.tieredPricing;
  const role = product?.pricingKey || 'retail';

  const roleTiers = Array.isArray(tiers?.[role])
    ? tiers[role]
    : Object.values(tiers || {}).find(Array.isArray);

  if (roleTiers?.length) {
    const first = [...roleTiers].sort(
      (a, b) =>
        Number(a.min_quantity ?? a.minQuantity ?? 1) -
        Number(b.min_quantity ?? b.minQuantity ?? 1)
    )[0];

    return asNumber(first?.price ?? first?.rate ?? first?.unitPrice);
  }

  return null;
};

// Use one image only. Prefer the primary image field.
const getProductImage = (product) => {
  const candidates = [
    product?.image,
    product?.imageUrl,
    product?.thumbnail,
    ...(Array.isArray(product?.imageUrls) ? product.imageUrls : []),
    ...(Array.isArray(product?.additionalImages)
      ? product.additionalImages
      : []),
    ...(Array.isArray(product?.images) ? product.images : []),
  ];

  return (
    candidates.find(
      (value) => typeof value === 'string' && value.trim()
    ) || ''
  );
};

const createSlug = (value) =>
  String(value || 'product')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const ProductCard = ({
  product = {},
  onIncrement,
  onDecrement,
  cart = [],
}) => {
  const navigate = useNavigate();

  const image = useMemo(() => getProductImage(product), [product]);

  const price = useMemo(() => getPrice(product), [product]);
  const stock = readStock(product);

  const title =
    product.productName ||
    product.title ||
    product.name ||
    'Product';

  const code =
    product.productCode ||
    product.sku ||
    product.barcode ||
    '';

  const vendor = product.vendor || product.brandName || '';

  const compareAtPrice = asNumber(
    product.compareAtPrice ?? product.compare_at_price
  );

  const computedDiscount =
    price !== null && compareAtPrice !== null && compareAtPrice > price
      ? Math.round(((compareAtPrice - price) / compareAtPrice) * 100)
      : null;

  const providedDiscount = asNumber(product.discountPercentage);

  const discount =
    computedDiscount ??
    (providedDiscount !== null && providedDiscount > 0
      ? Math.round(providedDiscount)
      : null);

  const showComparePrice =
    compareAtPrice !== null &&
    price !== null &&
    compareAtPrice > price;

  const isUnavailable =
    product.available === false ||
    product.status === 'inactive' ||
    (product.trackInventory === true && stock !== null && stock <= 0);

  const cartItems = Array.isArray(cart)
    ? cart
    : cart && typeof cart === 'object'
      ? Object.values(cart)
      : [];

  const cartEntry = cartItems.find(
    (item) =>
      item.id === product.id &&
      item.subcollectionId === product.subcollectionId
  );

  const cartQty = Number(
    cartEntry?.quantity ?? cartEntry?.qty ?? 0
  ) || 0;

  // Keep the IDs in the URL so ProductDetailsPage can load the
  // correct product and its subcollection data from Firestore.
  const collectionId =
    product.collectionId ||
    product.mainCollection ||
    product.collection ||
    '';

  const subcollectionId = product.subcollectionId || '';

  const productId =
    product.id ||
    product.productId ||
    '';

  const productSlug = createSlug(title);

  const openProductDetails = () => {
    if (!collectionId || !subcollectionId || !productId) {
      console.error('Cannot open product details: missing product route IDs.', {
        collectionId,
        subcollectionId,
        productId,
        product,
      });
      return;
    }

    navigate(
      `/product/${productSlug}/${encodeURIComponent(collectionId)}/${encodeURIComponent(subcollectionId)}/${encodeURIComponent(productId)}`
    );
  };

  return (
    <article className="tanishka-product-card">
      <div
        className="tpc-media"
        role="link"
        tabIndex={0}
        aria-label={`View details for ${title}`}
        onClick={openProductDetails}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openProductDetails();
          }
        }}
        style={{ cursor: 'pointer' }}
      >
        <div className="tpc-media-topline">
          <span className="tpc-brand-mark">TANISHKA</span>

          {discount !== null && discount > 0 && (
            <span className="tpc-discount-badge">
              <span className="tpc-discount-kicker">
                SPECIAL SAVING
              </span>
              <strong>SAVE {discount}%</strong>
            </span>
          )}
        </div>

        {stock !== null && stock > 0 && stock <= 10 && (
          <span className="tpc-stock-badge">
            Only {stock} left
          </span>
        )}

        {image ? (
          <img
            className="tpc-image"
            src={image}
            alt={title}
            loading="lazy"
            decoding="async"
            onError={(event) => {
              event.currentTarget.style.display = 'none';
            }}
          />
        ) : (
          <div
            className="tpc-image-fallback"
            role="img"
            aria-label="Product image unavailable"
          >
            <span aria-hidden="true">✧</span>
            <small>Product preview</small>
          </div>
        )}
      </div>

      <div className="tpc-body">
        <div className="tpc-meta-row">
          {vendor && (
            <span className="tpc-vendor">{vendor}</span>
          )}

          {code && (
            <span className="tpc-code">DESIGN {code}</span>
          )}
        </div>

        <h3
          className="tpc-title"
          title={title}
          role="link"
          tabIndex={0}
          onClick={openProductDetails}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              openProductDetails();
            }
          }}
          style={{ cursor: 'pointer' }}
        >
          {title}
        </h3>

        {product.productType && (
          <span className="tpc-type">
            {product.productType}
          </span>
        )}

        <div className="tpc-price-area">
          <div className="tpc-price-line">
            {price !== null ? (
              <strong className="tpc-price">
                {formatINR(price)}
              </strong>
            ) : (
              <strong className="tpc-login-price">
                Login to view price
              </strong>
            )}

            {showComparePrice && (
              <del className="tpc-compare-price">
                {formatINR(compareAtPrice)}
              </del>
            )}
          </div>

          <div className="tpc-price-caption">
            <span>Your price</span>

            {showComparePrice && (
              <span className="tpc-savings">
                You save {formatINR(compareAtPrice - price)}{' '}
                <b>
                  (
                  {Math.round(
                    ((compareAtPrice - price) / compareAtPrice) * 100
                  )}
                  % saved)
                </b>
              </span>
            )}
          </div>
        </div>

        <div className="tpc-footer">
          {stock !== null && (
            <span
              className={`tpc-availability ${
                stock > 0 ? 'is-available' : 'is-soldout'
              }`}
            >
              <i aria-hidden="true" />
              {stock > 0 ? 'In stock' : 'Out of stock'}
            </span>
          )}

          {cartQty > 0 ? (
            <div
              className="tpc-quantity-control"
              aria-label="Cart quantity"
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                aria-label={`Remove one ${title}`}
                onClick={() =>
                  onDecrement?.(
                    cartEntry?.id ||
                    cartEntry?.cartItemId ||
                    product.id
                  )
                }
              >
                −
              </button>

              <span>{cartQty}</span>

              <button
                type="button"
                aria-label={`Add one ${title}`}
                disabled={isUnavailable}
                onClick={() =>
                  onIncrement?.(product, product.variation)
                }
              >
                +
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="tpc-add-button"
              disabled={isUnavailable}
              onClick={() =>
                onIncrement?.(product, product.variation)
              }
            >
              <span>
                {isUnavailable ? 'Unavailable' : 'Add to bag'}
              </span>

              <span className="tpc-add-icon" aria-hidden="true">
                ↗
              </span>
            </button>
          )}
        </div>
      </div>
    </article>
  );
};

export default ProductCard;
