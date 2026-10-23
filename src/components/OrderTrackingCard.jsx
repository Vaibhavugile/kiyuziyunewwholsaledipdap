import React, { useMemo } from 'react';
import './OrderTrackingCard.css';

const ORDER_STEPS = [
  { key: 'Pending', label: 'Order placed', description: 'We received your order', icon: '✓' },
  { key: 'Processing', label: 'Preparing', description: 'Your order is being prepared', icon: '◷' },
  { key: 'Shipped', label: 'On the way', description: 'Your parcel has been dispatched', icon: '↗' },
  { key: 'Delivered', label: 'Delivered', description: 'Enjoy your new favourites', icon: '♡' },
];

const normalizeStatus = (value) => {
  const status = String(value || 'Pending').trim().toLowerCase();

  if (['confirmed', 'order placed', 'placed', 'pending'].includes(status)) return 'Pending';
  if (['processing', 'preparing', 'packed'].includes(status)) return 'Processing';
  if (['shipped', 'in transit', 'in_transit', 'out for delivery', 'out_for_delivery'].includes(status)) return 'Shipped';
  if (['delivered', 'complete', 'completed'].includes(status)) return 'Delivered';
  if (['cancelled', 'canceled', 'refunded', 'failed'].includes(status)) return 'Cancelled';
  return 'Pending';
};

const formatDate = (value) => {
  if (!value) return 'Date unavailable';

  try {
    const date = typeof value?.toDate === 'function'
      ? value.toDate()
      : value instanceof Date
        ? value
        : new Date(value);

    if (Number.isNaN(date.getTime())) return 'Date unavailable';

    return new Intl.DateTimeFormat('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(date);
  } catch {
    return 'Date unavailable';
  }
};

const money = (value) => {
  const number = Number(value);
  return Number.isFinite(number)
    ? number.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '0.00';
};

const getItemImage = (item) => {
  if (Array.isArray(item?.images) && item.images.length > 0) return item.images[0];
  if (Array.isArray(item?.imageUrls) && item.imageUrls.length > 0) return item.imageUrls[0];
  if (typeof item?.image === 'string' && item.image) return item.image;
  if (typeof item?.imageUrl === 'string' && item.imageUrl) return item.imageUrl;
  return '';
};

const OrderTrackingCard = ({ order }) => {
  const status = normalizeStatus(order?.status || order?.orderStatus || order?.shippingStatus);
  const orderId = String(order?.orderNumber || order?.id || 'ORDER');
  const shortOrderId = orderId.length > 12 ? orderId.slice(0, 8).toUpperCase() : orderId.toUpperCase();
  const orderDate = formatDate(order?.createdAt);
  const items = Array.isArray(order?.items) ? order.items : [];
  const isCancelled = status === 'Cancelled';

  const currentStatusIndex = useMemo(
    () => ORDER_STEPS.findIndex((step) => step.key === status),
    [status]
  );

  const itemCount = items.reduce((sum, item) => sum + (Number(item?.quantity) || 1), 0);
  const subtotal = order?.subtotal;
  const shippingFee = order?.shippingFee;
  const totalAmount = order?.totalAmount ?? order?.total ?? (
    Number(subtotal || 0) + Number(shippingFee || 0)
  );

  const paymentStatus = String(order?.paymentStatus || (order?.paymentMethod ? order.paymentMethod : 'Payment details')).trim();
  const paymentLabel = paymentStatus.replace(/_/g, ' ');

  return (
    <article className={`order-tracking-card ${isCancelled ? 'order-tracking-card--cancelled' : ''}`}>
      <div className="otc-top-accent" aria-hidden="true" />

      <header className="order-card-header">
        <div className="order-header-info">
          <span className="otc-overline">ORDER DETAILS</span>
          <h3 className="order-id">#{shortOrderId}</h3>
          <p className="order-date"><span aria-hidden="true">◷</span> Placed on {orderDate}</p>
        </div>

        <div className="otc-header-right">
          <span className={`order-status status-${status.toLowerCase()}`}>
            <span className="order-status__dot" aria-hidden="true" />
            {status}
          </span>
          <span className="otc-item-count">{itemCount} {itemCount === 1 ? 'item' : 'items'}</span>
        </div>
      </header>

      {!isCancelled && (
        <section className="order-timeline-section" aria-label={`Order progress: ${status}`}>
          <div className="otc-section-heading">
            <span>YOUR DELIVERY JOURNEY</span>
            <span className="otc-progress-label">{Math.round(((currentStatusIndex + 1) / ORDER_STEPS.length) * 100)}% complete</span>
          </div>
          <div className="order-timeline">
            <div className="order-timeline__track" aria-hidden="true">
              <span style={{ width: `${Math.max(0, (currentStatusIndex / (ORDER_STEPS.length - 1)) * 100)}%` }} />
            </div>
            {ORDER_STEPS.map((step, index) => {
              const complete = index <= currentStatusIndex;
              const active = index === currentStatusIndex;
              return (
                <div
                  key={step.key}
                  className={`timeline-step ${complete ? 'completed' : ''} ${active ? 'active' : ''}`}
                  aria-current={active ? 'step' : undefined}
                >
                  <div className="timeline-circle">{complete ? step.icon : <span>{index + 1}</span>}</div>
                  <p className="timeline-status-text">{step.label}</p>
                  <span className="timeline-step__description">{step.description}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {isCancelled && (
        <div className="otc-cancelled-notice">
          <span aria-hidden="true">!</span>
          <div>
            <strong>This order is {status.toLowerCase()}.</strong>
            <p>If you need help, please contact our support team.</p>
          </div>
        </div>
      )}

      <section className="order-items-section">
        <div className="otc-section-heading">
          <span>YOUR ITEMS</span>
          <span>{items.length} {items.length === 1 ? 'product' : 'products'}</span>
        </div>

        {items.length ? (
          <div className="order-items-summary">
            {items.map((item, index) => {
              const image = getItemImage(item);
              const name = item?.productName || item?.name || item?.title || 'Product';
              const quantity = Number(item?.quantity) || 1;
              const unitPrice = Number(item?.price ?? item?.salePrice ?? item?.unitPrice) || 0;
              const lineTotal = Number(item?.totalPrice ?? item?.lineTotal) || unitPrice * quantity;

              return (
                <div key={item?.id || item?.productId || `${name}-${index}`} className="order-item">
                  <div className="item-image-wrap">
                    {image ? (
                      <img src={image} alt={name} className="item-image" loading="lazy" />
                    ) : (
                      <div className="item-image item-image--placeholder" aria-label="No product image available">
                        <span aria-hidden="true">✧</span>
                      </div>
                    )}
                  </div>
                  <div className="item-details">
                    <h4 className="item-name">{name}</h4>
                    <p className="item-code">{item?.productCode || item?.sku || 'Kiyu Ziyu collection'}</p>
                    <div className="item-meta">
                      <span>Qty <strong>{quantity}</strong></span>
                      <span className="item-meta__divider" />
                      <span>₹{money(unitPrice)} each</span>
                    </div>
                  </div>
                  <p className="item-price">₹{money(lineTotal)}</p>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="otc-no-items">Item details are not available for this order.</p>
        )}
      </section>

      <footer className="order-card-footer">
        <div className="otc-payment-note">
          <span className="otc-payment-note__icon" aria-hidden="true">▣</span>
          <div>
            <span className="otc-payment-note__label">PAYMENT</span>
            <strong>{paymentLabel || 'Payment details unavailable'}</strong>
          </div>
        </div>

        <div className="order-totals">
          <p><span>Subtotal</span><strong>₹{money(subtotal)}</strong></p>
          <p><span>Shipping</span><strong>₹{money(shippingFee)}</strong></p>
          {Number(order?.discountAmount || order?.discount || 0) > 0 && (
            <p className="otc-discount"><span>Discount</span><strong>−₹{money(order?.discountAmount ?? order?.discount)}</strong></p>
          )}
          <p className="final-total"><span>Total paid</span><strong>₹{money(totalAmount)}</strong></p>
        </div>
      </footer>
    </article>
  );
};

export default OrderTrackingCard;
