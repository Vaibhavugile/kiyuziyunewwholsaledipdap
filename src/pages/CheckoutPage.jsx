import React, { useEffect, useMemo, useState } from 'react';
import { useCart } from '../components/CartContext';
import { useAuth } from '../components/AuthContext';
import { useNavigate } from 'react-router-dom';
import './CheckoutPage.css';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { getRoleConfig } from '../config/roles';
import { trackMetaEvent } from '../utils/pixels';

const SHIPPING_FEE = 249;
const GST_RATE = 0.18;

const formatCheckoutCurrency = (value) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);

const getCheckoutImage = (item) => {
  const firstImage = Array.isArray(item?.images) ? item.images[0] : null;
  const url =
    (typeof firstImage === 'string' ? firstImage : firstImage?.url) ||
    item?.image ||
    item?.imageUrl ||
    '';
  return typeof url === 'string' ? url : '';
};

const CheckoutPage = () => {
  const {
    cart = {},
    getCartTotal,
    getCartSubtotal,
    getFinalTotal,
    clearCart,
    checkMinOrderValue,
    removeItemFromCart,
    appliedCoupon,
    couponDiscount,
    removeCoupon,
  } = useCart();

  const { currentUser, userRole } = useAuth();
  const navigate = useNavigate();

  const {
    isMinOrderApplicable,
    isMinMet,
    minimumRequired,
  } = checkMinOrderValue();

  const subtotal = Number(getCartSubtotal?.() || 0);
  const finalTotal = Number(getFinalTotal?.() ?? subtotal);
  const displayedCouponDiscount = Math.max(0, Number(couponDiscount || 0));
  const taxableSubtotal = Math.max(0, subtotal - displayedCouponDiscount);
  const gstAmount = Math.round((taxableSubtotal * GST_RATE + Number.EPSILON) * 100) / 100;
  const checkoutTotal = taxableSubtotal + gstAmount + SHIPPING_FEE;
  const showMinOrderWarning = Boolean(isMinOrderApplicable && !isMinMet);
  const minimumRemaining = Math.max(0, Number(minimumRequired || 0) - Number(getCartTotal?.() || 0));

  const roleConfig = getRoleConfig(userRole);
  const isOnlinePayment = roleConfig?.paymentMode === 'ONLINE';

  const [invalidItems, setInvalidItems] = useState([]);
  const [formData, setFormData] = useState({
    fullName: '',
    email: currentUser?.email || '',
    phoneNumber: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    pincode: '',
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [imageErrors, setImageErrors] = useState({});

  const cartItems = useMemo(() => Object.values(cart || {}), [cart]);
  const totalQuantity = cartItems.reduce((sum, item) => sum + Math.max(0, Number(item?.quantity || 0)), 0);

  useEffect(() => {
    if (cartItems.length > 0) {
      trackMetaEvent('InitiateCheckout', {
        content_ids: cartItems.map((item) => item.id).filter(Boolean),
        content_type: 'product',
        value: finalTotal,
        currency: 'INR',
        num_items: totalQuantity,
      });
    }
    // Fire this event once when checkout mounts, matching the original flow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (currentUser?.email) {
      setFormData((previous) => (
        previous.email === currentUser.email
          ? previous
          : { ...previous, email: currentUser.email }
      ));
    }
  }, [currentUser?.email]);

  const loadRazorpay = () =>
    new Promise((resolve) => {
      const existingScript = document.querySelector('script[data-checkout-razorpay="true"]');
      if (window.Razorpay) {
        resolve(true);
        return;
      }
      if (existingScript) {
        existingScript.addEventListener('load', () => resolve(true), { once: true });
        existingScript.addEventListener('error', () => resolve(false), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.async = true;
      script.dataset.checkoutRazorpay = 'true';
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });

  const handleInputChange = (event) => {
    const { name, value } = event.target;
    setFormData((previous) => ({ ...previous, [name]: value }));
  };

  const validateCouponBeforeOrder = async () => {
    if (!appliedCoupon) return { valid: true, discount: 0 };

    const couponRef = doc(db, 'coupons', appliedCoupon.code);
    const couponSnap = await getDoc(couponRef);

    if (!couponSnap.exists()) {
      removeCoupon?.();
      throw new Error('This coupon no longer exists. Please review your order.');
    }

    const coupon = couponSnap.data();
    const now = new Date();
    const subtotalNow = Number(getCartSubtotal?.() || 0);

    if (coupon.isActive === false) throw new Error('This coupon is currently disabled.');

    const expiryDate = coupon.expiry?.toDate ? coupon.expiry.toDate() : null;
    if (expiryDate && expiryDate < now) throw new Error('This coupon has expired.');

    if (subtotalNow < Number(coupon.minOrderValue || 0)) {
      throw new Error('Your order no longer meets this coupon’s minimum value.');
    }

    if (
      Number(coupon.maxUses || 0) > 0 &&
      Number(coupon.usedCount || 0) >= Number(coupon.maxUses)
    ) {
      throw new Error('This coupon has reached its usage limit.');
    }

    let discount = coupon.type === 'percentage'
      ? (subtotalNow * Number(coupon.value || 0)) / 100
      : Number(coupon.value || 0);

    discount = Math.min(Math.max(0, discount), subtotalNow);
    return { valid: true, discount };
  };

  const loadRazorpayAndPay = async (orderId, amount) => {
    const sdkLoaded = await loadRazorpay();
    if (!sdkLoaded || !window.Razorpay) {
      throw new Error('Payment service could not load. Please check your connection and try again.');
    }

    const orderResponse = await fetch(
      'https://us-central1-tanishkaretail-4a7e1.cloudfunctions.net/createRazorpayOrder',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, receipt: orderId }),
      }
    );

    if (!orderResponse.ok) {
      let message = 'Unable to initialize your payment.';
      try {
        const responseBody = await orderResponse.json();
        message = responseBody.error || message;
      } catch {
        // Keep the fallback message when the response is not JSON.
      }
      throw new Error(message);
    }

    const razorpayOrder = await orderResponse.json();

    const options = {
      key: 'rzp_live_S5qE67r4g2LR2M',
      amount: razorpayOrder.amount,
      currency: 'INR',
      name: 'Kiyu-Ziyu Jewellery',
      description: `Order #${orderId}`,
      order_id: razorpayOrder.id,
      prefill: {
        name: formData.fullName,
        email: formData.email,
        contact: formData.phoneNumber,
      },
      theme: { color: '#8f3d62' },
      handler: async (paymentResponse) => {
        try {
          const verifyResponse = await fetch(
            'https://us-central1-tanishkaretail-4a7e1.cloudfunctions.net/markOrderPaid',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                orderId,
                paymentId: paymentResponse.razorpay_payment_id,
                razorpayOrderId: paymentResponse.razorpay_order_id,
                razorpaySignature: paymentResponse.razorpay_signature,
              }),
            }
          );

          if (!verifyResponse.ok) {
            throw new Error('Payment was received, but order confirmation is pending. Please contact support before retrying payment.');
          }

          trackMetaEvent('Purchase', {
            content_ids: cartItems.map((item) => item.id).filter(Boolean),
            content_type: 'product',
            value: amount,
            currency: 'INR',
            num_items: totalQuantity,
          });
          clearCart?.();
          navigate('/order-success');
        } catch (paymentError) {
          setError(paymentError.message || 'Unable to verify the payment. Please contact support.');
        } finally {
          setIsProcessing(false);
        }
      },
      modal: {
        ondismiss: () => setIsProcessing(false),
      },
    };

    const razorpayInstance = new window.Razorpay(options);
    razorpayInstance.on('payment.failed', (event) => {
      setError(event?.error?.description || 'Payment failed. Please try again.');
      setIsProcessing(false);
    });
    razorpayInstance.open();
  };

  const handleSubmitOrder = async (event) => {
    event.preventDefault();
    if (isProcessing) return;
    setIsProcessing(true);
    setError(null);

    try {
      if (showMinOrderWarning) {
        throw new Error(
          `Minimum order of ${formatCheckoutCurrency(minimumRequired)} not met. Add ${formatCheckoutCurrency(minimumRemaining)} more to proceed.`
        );
      }

      if (cartItems.length === 0) throw new Error('Your cart is empty.');

      const requiredFields = [
        'fullName', 'email', 'phoneNumber', 'addressLine1', 'city', 'state', 'pincode',
      ];
      if (requiredFields.some((field) => !String(formData[field] || '').trim())) {
        throw new Error('Please fill out all required shipping details.');
      }

      const validatedItems = cartItems.map((item) => {
        if (
          !item.id ||
          !item.productCode ||
          !Number(item.quantity) ||
          item.price == null ||
          !item.subcollectionId ||
          !item.collectionId ||
          !item.productName
        ) {
          console.error('Invalid cart item:', item);
          return null;
        }

        return {
          productId: item.id,
          productName: item.productName,
          productCode: item.productCode,
          image: item.image,
          images: item.images,
          quantity: Number(item.quantity),
          priceAtTimeOfOrder: Number(item.price),
          subcollectionId: item.subcollectionId,
          collectionId: item.collectionId,
          variation: item.variation,
        };
      }).filter(Boolean);

      if (validatedItems.length !== cartItems.length) {
        throw new Error('Some cart items are missing required product details. Please return to your cart and review them.');
      }

      const couponResult = await validateCouponBeforeOrder();
      const couponDiscountFinal = Number(couponResult.discount || 0);
      const subtotalNow = Number(getCartSubtotal?.() || 0);
      const taxableAmount = Math.max(0, subtotalNow - couponDiscountFinal);
      const gstAmountFinal = Math.round((taxableAmount * GST_RATE + Number.EPSILON) * 100) / 100;
      const totalWithShipping = Math.round((taxableAmount + gstAmountFinal + SHIPPING_FEE + Number.EPSILON) * 100) / 100;

      const orderData = {
        userId: currentUser?.uid || 'guest',
        role: userRole || 'retail',
        items: validatedItems,
        subtotal: subtotalNow,
        couponDiscount: couponDiscountFinal,
        taxableAmount,
        gstRate: 18,
        gstAmount: gstAmountFinal,
        shippingFee: SHIPPING_FEE,
        totalAmount: totalWithShipping,
        billingInfo: formData,
        status: 'Pending',
        couponCode: appliedCoupon?.code || null,
        couponDiscount: couponDiscountFinal,
      };

      const response = await fetch(
        'https://us-central1-tanishkaretail-4a7e1.cloudfunctions.net/placeorderr',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(orderData),
        }
      );

      if (response.status === 409) {
        const body = await response.json();
        const invalid = [];
        body.stockErrors?.forEach((entry) => invalid.push({ productId: entry.productId, variation: entry.variation || null }));
        body.variationErrors?.forEach((entry) => invalid.push({ productId: entry.productId, variation: entry.variation || null }));
        body.missingItems?.forEach((entry) => invalid.push({ productId: entry.productId, variation: null }));
        setInvalidItems(invalid);
        throw new Error('Some items are no longer available. Use the fix-cart option to remove them.');
      }

      if (!response.ok) {
        let message = 'Failed to place your order.';
        try {
          const body = await response.json();
          message = body.error || message;
        } catch {
          // Keep the fallback message.
        }
        throw new Error(message);
      }

      const responseData = await response.json();
      const createdOrderId = responseData.orderId;
      if (!createdOrderId) throw new Error('The order was submitted, but no order reference was returned. Please contact support before trying again.');

      if (!isOnlinePayment) {
        trackMetaEvent('Purchase', {
          content_ids: cartItems.map((item) => item.id).filter(Boolean),
          content_type: 'product',
          value: totalWithShipping,
          currency: 'INR',
          num_items: totalQuantity,
        });
        clearCart?.();
        navigate('/order-success');
        return;
      }

      await loadRazorpayAndPay(createdOrderId, totalWithShipping);
    } catch (submitError) {
      setError(submitError.message || 'Your order could not be completed. Please try again.');
      setIsProcessing(false);
    }
  };

  const handleAutoFixCart = () => {
    invalidItems.forEach(({ productId, variation }) => {
      removeItemFromCart?.(productId, variation);
    });
    setInvalidItems([]);
    setError(null);
  };

  return (
    <main className="checkout-page-container">
      <div className="checkout-page-shell">
        <header className="checkout-page-header">
          <div>
            <p className="checkout-eyebrow"><span /> A SMOOTH FINISH TO YOUR ORDER</p>
            <h1 className="checkout-page-title">Checkout <em>beautifully.</em></h1>
            <p className="checkout-page-intro">Add your delivery details and review your selection before placing your order.</p>
          </div>
          <button type="button" className="checkout-back-link" onClick={() => navigate('/cart')}>
            <span aria-hidden="true">←</span> Back to bag
          </button>
        </header>

        <div className="checkout-progress" aria-label="Checkout progress">
          <div className="checkout-progress-step is-complete"><span>✓</span><small>Shopping bag</small></div>
          <div className="checkout-progress-track"><span /></div>
          <div className="checkout-progress-step is-current"><span>02</span><small>Delivery details</small></div>
          <div className="checkout-progress-track" />
          <div className="checkout-progress-step"><span>03</span><small>Confirmation</small></div>
        </div>

        {error && (
          <div className="checkout-alert" role="alert">
            <span className="checkout-alert-icon" aria-hidden="true">!</span>
            <div><strong>We need your attention</strong><p>{error}</p></div>
            <button type="button" aria-label="Dismiss message" onClick={() => setError(null)}>×</button>
          </div>
        )}

        {invalidItems.length > 0 && (
          <section className="checkout-fix-cart-box">
            <div className="checkout-fix-cart-icon" aria-hidden="true">↻</div>
            <div className="checkout-fix-cart-copy"><strong>Some items need a quick update</strong><p>One or more products are unavailable or have changed. Remove the affected items and try again.</p></div>
            <button type="button" className="checkout-fix-cart-btn" onClick={handleAutoFixCart}>Fix my bag</button>
          </section>
        )}

        {cartItems.length > 0 ? (
          <div className="checkout-content">
            <section className="checkout-billing-section">
              <div className="checkout-section-heading">
                <span className="checkout-section-number">01</span>
                <div><p>DELIVERY INFORMATION</p><h2>Where should we send it?</h2></div>
              </div>
              <p className="checkout-section-description">Enter the details for the person receiving this order. Fields marked * are required.</p>

              <form className="checkout-billing-form" onSubmit={handleSubmitOrder}>
                <div className="checkout-form-grid">
                  <label className="checkout-field checkout-field-full">
                    <span>Full name <b>*</b></span>
                    <input name="fullName" autoComplete="name" placeholder="Name of recipient" value={formData.fullName} onChange={handleInputChange} required />
                  </label>
                  <label className="checkout-field">
                    <span>Email address <b>*</b></span>
                    <input name="email" type="email" autoComplete="email" placeholder="you@example.com" value={formData.email} onChange={handleInputChange} required />
                  </label>
                  <label className="checkout-field">
                    <span>Phone number <b>*</b></span>
                    <input name="phoneNumber" type="tel" inputMode="tel" autoComplete="tel" placeholder="For delivery updates" value={formData.phoneNumber} onChange={handleInputChange} required />
                  </label>
                  <label className="checkout-field checkout-field-full">
                    <span>Address line 1 <b>*</b></span>
                    <input name="addressLine1" autoComplete="address-line1" placeholder="House number, street, area" value={formData.addressLine1} onChange={handleInputChange} required />
                  </label>
                  <label className="checkout-field checkout-field-full">
                    <span>Address line 2 <small>OPTIONAL</small></span>
                    <input name="addressLine2" autoComplete="address-line2" placeholder="Apartment, landmark, floor (optional)" value={formData.addressLine2} onChange={handleInputChange} />
                  </label>
                  <label className="checkout-field">
                    <span>City <b>*</b></span>
                    <input name="city" autoComplete="address-level2" placeholder="City" value={formData.city} onChange={handleInputChange} required />
                  </label>
                  <label className="checkout-field">
                    <span>State <b>*</b></span>
                    <input name="state" autoComplete="address-level1" placeholder="State" value={formData.state} onChange={handleInputChange} required />
                  </label>
                  <label className="checkout-field">
                    <span>PIN code <b>*</b></span>
                    <input name="pincode" inputMode="numeric" autoComplete="postal-code" maxLength={10} placeholder="Postal PIN code" value={formData.pincode} onChange={handleInputChange} required />
                  </label>
                </div>

                {showMinOrderWarning && (
                  <div className="checkout-minimum-warning" role="status">
                    <span aria-hidden="true">↗</span>
                    <p>Minimum order is {formatCheckoutCurrency(minimumRequired)}. Add <strong>{formatCheckoutCurrency(minimumRemaining)}</strong> more to continue.</p>
                  </div>
                )}

                <button type="submit" className="checkout-submit-btn" disabled={isProcessing || showMinOrderWarning}>
                  {isProcessing ? <><span className="checkout-spinner" /> Processing your order…</> : <>{isOnlinePayment ? 'Continue to secure payment' : 'Place your order'} <span aria-hidden="true">→</span></>}
                </button>
                <p className="checkout-form-footnote"><span aria-hidden="true">♧</span> Please double-check your details before placing your order.</p>
              </form>
            </section>

            <aside className="checkout-order-details">
              <div className="checkout-summary-topline"><span className="checkout-summary-star">✦</span><span>YOUR SELECTION</span><span className="checkout-summary-count">{totalQuantity} item{totalQuantity === 1 ? '' : 's'}</span></div>
              <h2 className="checkout-summary-title">Order summary</h2>
              <p className="checkout-summary-description">A final look at the pieces you picked.</p>

              <div className="checkout-order-items">
                {cartItems.map((item, index) => {
                  const imageUrl = getCheckoutImage(item);
                  const imageFailed = imageErrors[item.id];
                  const name = item.productName || item.name || 'Product';
                  return (
                    <article className="checkout-order-item" key={`${item.id || item.productCode || name}-${index}-${item.variation ? JSON.stringify(item.variation) : ''}`}>
                      <div className="checkout-order-item-image">
                        {imageUrl && !imageFailed ? (
                          <img
                            src={imageUrl}
                            alt={name}
                            loading="lazy"
                            decoding="async"
                            width="76"
                            height="88"
                            onError={() => setImageErrors((previous) => ({ ...previous, [item.id]: true }))}
                          />
                        ) : <span aria-label="Image unavailable" role="img">✦</span>}
                        <span className="checkout-order-item-quantity">{item.quantity}</span>
                      </div>
                      <div className="checkout-order-item-copy">
                        <h3>{name}</h3>
                        {item.productCode && <p>Style code {item.productCode}</p>}
                        {item.variation && <p>{[item.variation.color, item.variation.size].filter(Boolean).join(' · ')}</p>}
                        <span>{formatCheckoutCurrency(item.price)} each</span>
                      </div>
                      <strong className="checkout-order-item-total">{formatCheckoutCurrency(Number(item.price || 0) * Number(item.quantity || 0))}</strong>
                    </article>
                  );
                })}
              </div>

              <div className="checkout-summary-lines">
                <div className="checkout-summary-line"><span>Subtotal</span><strong>{formatCheckoutCurrency(subtotal)}</strong></div>
                {appliedCoupon && (
                  <div className="checkout-summary-line checkout-summary-discount">
                    <span>Coupon · {appliedCoupon.code}</span>
                    <strong>−{formatCheckoutCurrency(couponDiscount)}</strong>
                    <button type="button" onClick={removeCoupon}>Remove</button>
                  </div>
                )}
                {isMinOrderApplicable && (
                  <div className={`checkout-summary-line ${isMinMet ? 'checkout-minimum-met' : 'checkout-minimum-not-met'}`}>
                    <span>Minimum order</span><strong>{formatCheckoutCurrency(minimumRequired)}</strong>
                  </div>
                )}
                <div className="checkout-summary-line">
                  <span>GST (18%)</span>
                  <strong>{formatCheckoutCurrency(gstAmount)}</strong>
                </div>
                <div className="checkout-summary-line"><span>Shipping · DTDC by air</span><strong>{formatCheckoutCurrency(SHIPPING_FEE)}</strong></div>
                <div className="checkout-summary-shipping-note"><span aria-hidden="true">ⓘ</span> Shipping fee applies for consignments up to 1 kg. Confirm any additional charges before dispatch.</div>
              </div>

              <div className="checkout-summary-total">
                <div><span>Total payable</span><small>Including 18% GST and shipping fee</small></div>
                <strong>{formatCheckoutCurrency(checkoutTotal)}</strong>
              </div>

              <div className="checkout-summary-security"><span aria-hidden="true">♧</span><div><strong>{isOnlinePayment ? 'Secure online payment' : 'Order confirmation'}</strong><p>{isOnlinePayment ? 'Your payment is handled through the payment checkout.' : 'Your order details will be submitted for confirmation.'}</p></div></div>
              <button type="button" className="checkout-summary-back" onClick={() => navigate('/cart')}>← Return to shopping bag</button>
            </aside>
          </div>
        ) : (
          <section className="checkout-empty-state">
            <div className="checkout-empty-icon" aria-hidden="true">✦</div>
            <p className="checkout-eyebrow">NOTHING TO CHECK OUT JUST YET</p>
            <h2>Your shopping bag is empty.</h2>
            <p>Choose something you love and it will appear here.</p>
            <button type="button" className="checkout-submit-btn checkout-empty-cta" onClick={() => navigate('/')}>Explore the collection <span aria-hidden="true">→</span></button>
          </section>
        )}

        <footer className="checkout-page-footer"><span>THOUGHTFULLY SELECTED.</span><span>MADE TO FEEL JUST RIGHT.</span></footer>
      </div>
    </main>
  );
};

export default CheckoutPage;
