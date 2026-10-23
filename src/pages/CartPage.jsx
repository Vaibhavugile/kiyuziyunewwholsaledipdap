import React, { useCallback, useMemo, useState } from 'react';
import { useCart } from '../components/CartContext';
import { useAuth } from '../components/AuthContext';
import './CartPage.css';
import { useNavigate } from 'react-router-dom';
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
} from 'firebase/firestore';
import { db } from '../firebase';
import { trackMetaEvent } from '../utils/pixels';

const formatCurrency = (value) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);

const getImageUrl = (item) => {
  const firstImage = Array.isArray(item?.images) ? item.images[0] : null;
  const url =
    (typeof firstImage === 'string' ? firstImage : firstImage?.url) ||
    item?.image ||
    item?.imageUrl ||
    '';
  return typeof url === 'string' ? url : '';
};

const CartPage = () => {
  const navigate = useNavigate();
  const {
    cart = {},
    addToCart,
    removeFromCart,
    getCartSubtotal,
    getFinalTotal,
    clearCart,
    applyCoupon,
    removeCoupon,
    appliedCoupon,
    couponDiscount,
  } = useCart();

  const { userRole, roleConfig, currentUser } = useAuth();

  const [couponInput, setCouponInput] = useState('');
  const [loadingCoupon, setLoadingCoupon] = useState(false);
  const [couponUiError, setCouponUiError] = useState('');
  const [imageErrors, setImageErrors] = useState({});
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const cartItems = useMemo(
    () => Object.entries(cart).map(([cartItemId, item]) => ({ cartItemId, item })),
    [cart]
  );

  const subtotal = Number(getCartSubtotal?.() || 0);
  const finalTotal = Number(getFinalTotal?.() ?? subtotal);
  const minimumRequired = Math.max(0, Number(roleConfig?.minOrderValue || 0));
  const isMinOrderApplicable = minimumRequired > 0;
  const isMinMet = subtotal >= minimumRequired;
  const minimumRemaining = Math.max(0, minimumRequired - subtotal);
  const showMinOrderWarning = isMinOrderApplicable && !isMinMet;
  const totalQuantity = cartItems.reduce(
    (sum, { item }) => sum + Math.max(0, Number(item?.quantity || 0)),
    0
  );

  const handleDecrement = useCallback(
    (cartItemId) => removeFromCart?.(cartItemId),
    [removeFromCart]
  );

  const handleIncrement = useCallback(
    (item) => addToCart?.(item),
    [addToCart]
  );

  const handleApplyCoupon = async (event) => {
    event?.preventDefault?.();
    const code = couponInput.trim().toUpperCase();
    if (!code || loadingCoupon) return;

    try {
      setLoadingCoupon(true);
      setCouponUiError('');

      const couponSnap = await getDoc(doc(db, 'coupons', code));
      if (!couponSnap.exists()) throw new Error('That coupon code was not found.');

      const coupon = couponSnap.data();

      if (
        Array.isArray(coupon.allowedRoles) &&
        coupon.allowedRoles.length > 0 &&
        !coupon.allowedRoles.includes(userRole)
      ) {
        throw new Error('This coupon is not available for your account.');
      }

      const minOrderValue = Number(coupon.minOrderValue || 0);
      if (subtotal < minOrderValue) {
        throw new Error(`Add ${formatCurrency(minOrderValue - subtotal)} more to use this coupon.`);
      }

      if (
        Number(coupon.maxUses || 0) > 0 &&
        Number(coupon.usedCount || 0) >= Number(coupon.maxUses)
      ) {
        throw new Error('This coupon has reached its usage limit.');
      }

      if (Number(coupon.maxUsesPerUser || 0) > 0 && currentUser?.uid) {
        const usageQuery = query(
          collection(db, 'couponUsages'),
          where('couponCode', '==', coupon.code || code),
          where('userId', '==', currentUser.uid)
        );
        const usageSnap = await getDocs(usageQuery);
        if (usageSnap.size >= Number(coupon.maxUsesPerUser)) {
          throw new Error(`You can use this coupon only ${coupon.maxUsesPerUser} time(s).`);
        }
      }

      await applyCoupon?.(coupon, userRole);
      setCouponInput('');
    } catch (error) {
      console.error('Unable to apply coupon:', error);
      setCouponUiError(error?.message || 'We could not apply that coupon. Please try again.');
    } finally {
      setLoadingCoupon(false);
    }
  };

  const handleRemoveCoupon = () => {
    removeCoupon?.();
    setCouponUiError('');
  };

  const handleCheckout = () => {
    if (!cartItems.length || showMinOrderWarning) return;

    trackMetaEvent('InitiateCheckout', {
      content_ids: cartItems.map(({ item }) => item.id || item.productId).filter(Boolean),
      content_type: 'product',
      value: finalTotal,
      currency: 'INR',
      num_items: totalQuantity,
    });
    navigate('/checkout');
  };

  const handleClearCart = () => {
    trackMetaEvent('RemoveFromCart', {
      content_ids: cartItems.map(({ item }) => item.id || item.productId).filter(Boolean),
      content_type: 'product',
      value: finalTotal,
      currency: 'INR',
      num_items: totalQuantity,
    });
    clearCart?.();
    setShowClearConfirm(false);
  };

  return (
    <main className="cart-page-container">
      <div className="cart-page-shell">
        <header className="cart-page-header">
          <div>
            <p className="cart-eyebrow"><span className="cart-eyebrow-dot" /> YOUR EDIT, READY WHEN YOU ARE</p>
            <h1 className="cart-title">Shopping <span>Bag</span></h1>
            <p className="cart-header-description">
              Review your pieces, make it yours, and continue to a smooth checkout.
            </p>
          </div>
          <button type="button" className="cart-continue-link" onClick={() => navigate(-1)}>
            <span aria-hidden="true">←</span> Continue shopping
          </button>
        </header>

        <div className="cart-progress" aria-label="Checkout progress">
          <div className="cart-progress-step is-current"><span className="cart-progress-number">01</span><span>Shopping bag</span></div>
          <span className="cart-progress-line" />
          <div className="cart-progress-step"><span className="cart-progress-number">02</span><span>Checkout</span></div>
          <span className="cart-progress-line" />
          <div className="cart-progress-step"><span className="cart-progress-number">03</span><span>Confirmation</span></div>
        </div>

        {cartItems.length === 0 ? (
          <section className="cart-empty-state">
            <div className="cart-empty-art" aria-hidden="true">
              <div className="cart-empty-orbit cart-empty-orbit-one" />
              <div className="cart-empty-orbit cart-empty-orbit-two" />
              <div className="cart-empty-bag"><span>✦</span></div>
            </div>
            <p className="cart-eyebrow">A LITTLE ROOM FOR SOMETHING LOVELY</p>
            <h2>Your bag is taking a breather.</h2>
            <p className="cart-empty-copy">Explore the collection and add the pieces you love. They’ll be waiting here when you’re ready.</p>
            <button type="button" className="cart-primary-button cart-empty-cta" onClick={() => navigate('/')}>
              Explore the collection <span aria-hidden="true">↗</span>
            </button>
          </section>
        ) : (
          <>
            <div className="cart-content-grid">
              <section className="cart-items-panel" aria-label="Items in your shopping bag">
                <div className="cart-section-heading">
                  <div>
                    <p className="cart-section-kicker">YOUR SELECTION</p>
                    <h2>Your items <span className="cart-count-pill">{totalQuantity}</span></h2>
                  </div>
                  <button type="button" className="cart-text-button cart-clear-trigger" onClick={() => setShowClearConfirm(true)}>
                    Clear bag
                  </button>
                </div>

                {showClearConfirm && (
                  <div className="cart-confirm-banner" role="alert">
                    <div>
                      <strong>Clear your entire bag?</strong>
                      <p>This will remove all {totalQuantity} item{totalQuantity === 1 ? '' : 's'}.</p>
                    </div>
                    <div className="cart-confirm-actions">
                      <button type="button" className="cart-secondary-button compact" onClick={() => setShowClearConfirm(false)}>Keep items</button>
                      <button type="button" className="cart-danger-button" onClick={handleClearCart}>Clear bag</button>
                    </div>
                  </div>
                )}

                <div className="cart-items-list">
                  {cartItems.map(({ cartItemId, item }) => {
                    const imageUrl = getImageUrl(item);
                    const imageHasError = imageErrors[cartItemId];
                    const quantity = Math.max(1, Number(item?.quantity || 1));
                    const price = Number(item?.price || 0);
                    const itemName = item?.productName || item?.name || 'Product';
                    const variationLabel = [item?.variation?.color, item?.variation?.size].filter(Boolean).join(' · ');

                    return (
                      <article key={cartItemId} className="cart-item">
                        <div className="cart-item-media">
                          {imageUrl && !imageHasError ? (
                            <img
                              src={imageUrl}
                              alt={itemName}
                              className="cart-item-image1"
                              loading="lazy"
                              decoding="async"
                              width="144"
                              height="144"
                              onError={() => setImageErrors((previous) => ({ ...previous, [cartItemId]: true }))}
                            />
                          ) : (
                            <div className="cart-image-fallback" role="img" aria-label={`${itemName} image unavailable`}>
                              <span aria-hidden="true">✦</span>
                              <small>Image unavailable</small>
                            </div>
                          )}
                          <span className="cart-item-index">{String(cartItems.findIndex((entry) => entry.cartItemId === cartItemId) + 1).padStart(2, '0')}</span>
                        </div>

                        <div className="cart-item-info">
                          <p className="cart-item-overline">{item?.brand || 'CURATED FOR YOU'}</p>
                          <h3 className="cart-item-name">{itemName}</h3>
                          {variationLabel && <p className="cart-item-variation">{variationLabel}</p>}
                          {item?.productCode && <p className="cart-item-code">Style code <span>{item.productCode}</span></p>}
                          <div className="cart-item-mobile-price">
                            <span>Unit price</span><strong>{formatCurrency(price)}</strong>
                          </div>
                        </div>

                        <div className="cart-item-quantity-block">
                          <span className="cart-field-label">QUANTITY</span>
                          <div className="cart-quantity-controls" aria-label={`Quantity for ${itemName}`}>
                            <button type="button" aria-label={`Remove one ${itemName}`} onClick={() => handleDecrement(cartItemId)}>−</button>
                            <span aria-live="polite">{quantity}</span>
                            <button type="button" aria-label={`Add one ${itemName}`} onClick={() => handleIncrement(item)}>+</button>
                          </div>
                          <button type="button" className="cart-remove-link" onClick={() => handleDecrement(cartItemId)}>Remove</button>
                        </div>

                        <div className="cart-item-price-block">
                          <span className="cart-field-label">ITEM TOTAL</span>
                          <strong className="cart-item-subtotal">{formatCurrency(price * quantity)}</strong>
                          <span className="cart-item-unit-price">{formatCurrency(price)} each</span>
                        </div>
                      </article>
                    );
                  })}
                </div>

                <div className="cart-bottom-note">
                  <span className="cart-note-icon" aria-hidden="true">✓</span>
                  <p><strong>Your selection, your pace.</strong> Your bag is ready whenever you are.</p>
                </div>
              </section>

              <aside className="cart-summary" aria-label="Order summary">
                <div className="cart-summary-topline"><span className="cart-summary-icon" aria-hidden="true">✦</span><span>YOUR ORDER</span><span className="cart-summary-secure">SECURE</span></div>
                <h2 className="cart-summary-title">Order summary</h2>
                <p className="cart-summary-subtitle">A clear view of your total before checkout.</p>

                <div className="cart-summary-items-preview">
                  <span>{totalQuantity} item{totalQuantity === 1 ? '' : 's'} in your bag</span>
                  <strong>{formatCurrency(subtotal)}</strong>
                </div>

                <div className="cart-summary-line">
                  <span>Subtotal</span>
                  <strong>{formatCurrency(subtotal)}</strong>
                </div>

                {isMinOrderApplicable && (
                  <div className={`cart-summary-line cart-minimum-line ${isMinMet ? 'met' : 'not-met'}`}>
                    <span>Minimum order</span>
                    <strong>{formatCurrency(minimumRequired)}</strong>
                  </div>
                )}

                {Number(couponDiscount || 0) > 0 && (
                  <div className="cart-summary-line cart-discount-line">
                    <span>Coupon savings</span>
                    <strong>−{formatCurrency(couponDiscount)}</strong>
                  </div>
                )}

                {appliedCoupon ? (
                  <div className="cart-coupon-applied">
                    <div><span className="cart-coupon-check">✓</span><span><small>COUPON APPLIED</small><strong>{appliedCoupon.code}</strong></span></div>
                    <button type="button" onClick={handleRemoveCoupon}>Remove</button>
                  </div>
                ) : (
                  <form className="cart-coupon-form" onSubmit={handleApplyCoupon}>
                    <label htmlFor="cart-coupon-code">Have a promo code?</label>
                    <div className="cart-coupon-input-row">
                      <input
                        id="cart-coupon-code"
                        type="text"
                        value={couponInput}
                        onChange={(event) => { setCouponInput(event.target.value); setCouponUiError(''); }}
                        placeholder="Enter code"
                        autoComplete="off"
                        maxLength={64}
                        aria-describedby={couponUiError ? 'cart-coupon-error' : undefined}
                      />
                      <button type="submit" disabled={loadingCoupon || !couponInput.trim()}>
                        {loadingCoupon ? <span className="cart-button-spinner" aria-hidden="true" /> : 'Apply'}
                      </button>
                    </div>
                    {couponUiError && <p id="cart-coupon-error" className="cart-coupon-error" role="alert">{couponUiError}</p>}
                  </form>
                )}

                {showMinOrderWarning && (
                  <div className="cart-minimum-alert" role="status">
                    <span aria-hidden="true">↗</span>
                    <p>Add <strong>{formatCurrency(minimumRemaining)}</strong> more to meet your minimum order.</p>
                    <div className="cart-minimum-progress"><span style={{ width: `${Math.min(100, (subtotal / minimumRequired) * 100)}%` }} /></div>
                  </div>
                )}

                <div className="cart-summary-total">
                  <div><span>Total</span><small>Taxes and delivery shown at checkout, if applicable.</small></div>
                  <strong>{formatCurrency(finalTotal)}</strong>
                </div>

                <button
                  type="button"
                  className="cart-primary-button cart-checkout-button"
                  disabled={showMinOrderWarning}
                  onClick={handleCheckout}
                >
                  <span>Proceed to checkout</span><span aria-hidden="true">→</span>
                </button>
                {showMinOrderWarning && <p className="cart-checkout-hint">Your minimum order value has not been reached yet.</p>}

                <div className="cart-payment-note"><span aria-hidden="true">♧</span><div><strong>Checkout with confidence</strong><p>Your order total is shown before you confirm your purchase.</p></div></div>
                <button type="button" className="cart-continue-summary" onClick={() => navigate(-1)}>← Continue shopping</button>
              </aside>
            </div>
          </>
        )}

        <footer className="cart-page-footer">
          <span>THOUGHTFULLY SELECTED.</span><span>MADE TO FEEL JUST RIGHT.</span>
        </footer>
      </div>
    </main>
  );
};

export default CartPage;
