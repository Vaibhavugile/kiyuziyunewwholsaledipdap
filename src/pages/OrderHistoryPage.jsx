import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { db, collection, query, where, getDocs, orderBy } from '../firebase';
import { useAuth } from '../components/AuthContext';
import OrderTrackingCard from '../components/OrderTrackingCard';
import './OrderHistoryPage.css';

const normalize = (value) => String(value ?? '').toLowerCase().trim();

const getOrderStatus = (order) =>
  order?.status || order?.orderStatus || order?.shippingStatus || 'Processing';

const OrderHistoryPage = () => {
  const { currentUser } = useAuth();
  const [orders, setOrders] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  const fetchOrders = useCallback(async () => {
    if (!currentUser) {
      setOrders([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const ordersRef = collection(db, 'orders');
      const ordersQuery = query(
        ordersRef,
        where('userId', '==', currentUser.uid),
        orderBy('createdAt', 'desc')
      );
      const querySnapshot = await getDocs(ordersQuery);
      const fetchedOrders = querySnapshot.docs.map((document) => ({
        id: document.id,
        ...document.data(),
      }));
      setOrders(fetchedOrders);
    } catch (err) {
      console.error('Failed to fetch orders:', err);
      setError('We couldn’t load your orders right now. Please check your connection and try again.');
    } finally {
      setIsLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders, refreshKey]);

  const filteredOrders = useMemo(() => {
    const term = normalize(searchTerm);
    if (!term) return orders;

    return orders.filter((order) => {
      const searchableValues = [
        order.id,
        order.orderId,
        order.orderNumber,
        order.status,
        order.orderStatus,
        order.shippingStatus,
        order.paymentStatus,
      ];
      return searchableValues.some((value) => normalize(value).includes(term));
    });
  }, [orders, searchTerm]);

  const deliveredCount = useMemo(
    () => orders.filter((order) => {
      const status = normalize(getOrderStatus(order));
      return status === 'delivered' || status === 'complete' || status === 'completed';
    }).length,
    [orders]
  );

  const activeCount = Math.max(orders.length - deliveredCount, 0);

  if (isLoading) {
    return (
      <main className="order-history-page">
        <section className="orders-hero orders-hero--loading">
          <div className="orders-hero__glow orders-hero__glow--one" />
          <div className="orders-hero__glow orders-hero__glow--two" />
          <div className="orders-hero__content">
            <span className="orders-eyebrow"><span className="orders-eyebrow__dot" /> YOUR ACCOUNT</span>
            <h1>Your orders, <em>beautifully</em> organized.</h1>
            <p>Every detail of your shopping journey, all in one place.</p>
          </div>
        </section>
        <section className="orders-loading-grid" aria-label="Loading orders">
          <div className="orders-skeleton orders-skeleton--stat" />
          <div className="orders-skeleton orders-skeleton--stat" />
          <div className="orders-skeleton orders-skeleton--stat" />
          <div className="orders-skeleton orders-skeleton--list" />
          <div className="orders-skeleton orders-skeleton--list" />
        </section>
      </main>
    );
  }

  return (
    <main className="order-history-page">
      <section className="orders-hero">
        <div className="orders-hero__grain" aria-hidden="true" />
        <div className="orders-hero__glow orders-hero__glow--one" aria-hidden="true" />
        <div className="orders-hero__glow orders-hero__glow--two" aria-hidden="true" />
        <div className="orders-hero__content">
          <span className="orders-eyebrow"><span className="orders-eyebrow__dot" /> YOUR ACCOUNT</span>
          <h1>Your orders, <em>beautifully</em> organized.</h1>
          <p>From checkout to doorstep, keep every order in view.</p>
          <div className="orders-hero__bottom">
            <span className="orders-hero__microcopy">
              <span className="orders-sparkle" aria-hidden="true">✦</span>
              A little something lovely is on its way.
            </span>
            <span className="orders-hero__count">
              {orders.length} {orders.length === 1 ? 'ORDER' : 'ORDERS'}
            </span>
          </div>
        </div>
        <div className="orders-hero__orb" aria-hidden="true">
          <span className="orders-hero__orb-ring orders-hero__orb-ring--outer" />
          <span className="orders-hero__orb-ring orders-hero__orb-ring--inner" />
          <span className="orders-hero__orb-core">✦</span>
        </div>
      </section>

      <section className="orders-overview" aria-label="Order overview">
        <article className="orders-stat-card orders-stat-card--total">
          <div className="orders-stat-card__top">
            <span className="orders-stat-card__icon" aria-hidden="true">↗</span>
            <span className="orders-stat-card__label">ALL ORDERS</span>
          </div>
          <strong>{orders.length.toLocaleString('en-IN')}</strong>
          <span className="orders-stat-card__caption">Your shopping history</span>
        </article>
        <article className="orders-stat-card">
          <div className="orders-stat-card__top">
            <span className="orders-stat-card__icon orders-stat-card__icon--warm" aria-hidden="true">◷</span>
            <span className="orders-stat-card__label">IN PROGRESS</span>
          </div>
          <strong>{activeCount.toLocaleString('en-IN')}</strong>
          <span className="orders-stat-card__caption">Orders not marked delivered</span>
        </article>
        <article className="orders-stat-card">
          <div className="orders-stat-card__top">
            <span className="orders-stat-card__icon orders-stat-card__icon--green" aria-hidden="true">✓</span>
            <span className="orders-stat-card__label">DELIVERED</span>
          </div>
          <strong>{deliveredCount.toLocaleString('en-IN')}</strong>
          <span className="orders-stat-card__caption">Delivered successfully</span>
        </article>
      </section>

      <section className="orders-section">
        <div className="orders-section__heading">
          <div>
            <span className="orders-section__eyebrow">THE GOOD STUFF</span>
            <h2>Your order history<span>.</span></h2>
            <p>Track your purchases and revisit the details whenever you need.</p>
          </div>
          <button
            className="orders-refresh-button"
            type="button"
            onClick={() => setRefreshKey((value) => value + 1)}
            aria-label="Refresh orders"
            title="Refresh orders"
          >
            <span aria-hidden="true">↻</span> Refresh
          </button>
        </div>

        <div className="orders-toolbar">
          <label className="orders-search" htmlFor="orders-search-input">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="10.8" cy="10.8" r="6.8" />
              <path d="m16 16 4.2 4.2" />
            </svg>
            <input
              id="orders-search-input"
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search by order ID or status..."
              autoComplete="off"
            />
            {searchTerm && (
              <button type="button" className="orders-search__clear" onClick={() => setSearchTerm('')} aria-label="Clear search">
                ×
              </button>
            )}
          </label>
          <span className="orders-results-count">
            Showing <strong>{filteredOrders.length}</strong> of <strong>{orders.length}</strong>
          </span>
        </div>

        {error ? (
          <div className="orders-state-card orders-state-card--error" role="alert">
            <span className="orders-state-card__symbol" aria-hidden="true">!</span>
            <h3>We hit a little snag</h3>
            <p>{error}</p>
            <button type="button" className="orders-primary-button" onClick={() => setRefreshKey((value) => value + 1)}>
              Try again <span aria-hidden="true">↗</span>
            </button>
          </div>
        ) : orders.length === 0 ? (
          <div className="orders-state-card">
            <div className="orders-empty-art" aria-hidden="true">
              <span className="orders-empty-art__orbit orders-empty-art__orbit--one" />
              <span className="orders-empty-art__orbit orders-empty-art__orbit--two" />
              <span className="orders-empty-art__bag">♡</span>
              <span className="orders-empty-art__spark orders-empty-art__spark--one">✦</span>
              <span className="orders-empty-art__spark orders-empty-art__spark--two">✧</span>
            </div>
            <span className="orders-section__eyebrow">A FRESH START</span>
            <h3>Your next favourite is waiting.</h3>
            <p>You haven’t placed an order yet. When you do, all the details will appear here.</p>
            <a href="/collections" className="orders-primary-button">
              Explore the collection <span aria-hidden="true">↗</span>
            </a>
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="orders-state-card orders-state-card--compact">
            <span className="orders-state-card__symbol" aria-hidden="true">⌕</span>
            <h3>No matching orders</h3>
            <p>Try a different order ID or status.</p>
            <button type="button" className="orders-secondary-button" onClick={() => setSearchTerm('')}>Clear search</button>
          </div>
        ) : (
          <div className="order-list">
            {filteredOrders.map((order, index) => (
              <div className="order-list__item" key={order.id} style={{ '--order-index': index }}>
                <OrderTrackingCard order={order} />
              </div>
            ))}
          </div>
        )}

        <div className="orders-footer-note">
          <span aria-hidden="true">✦</span>
          Need help with an order? Reach out to our support team.
        </div>
      </section>
    </main>
  );
};

export default OrderHistoryPage;
