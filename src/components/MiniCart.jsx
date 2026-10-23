// src/components/MiniCart.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useCart } from './CartContext';
import { Link } from 'react-router-dom';
import {
  FaShoppingCart,
  FaTrashAlt,
  FaTimes,
  FaArrowRight,
  FaMinus,
  FaPlus,
  FaRegHeart,
} from 'react-icons/fa';
import './MiniCart.css';

const formatINR = (value) =>
  `₹${(Number(value) || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const getItemImage = (item = {}) => {
  const candidates = [
    item.thumbnail,
    item.image,
    item.imageUrl,
    ...(Array.isArray(item.images)
      ? item.images.map((image) =>
          typeof image === 'string' ? image : image?.url || image?.src
        )
      : []),
    ...(Array.isArray(item.imageUrls) ? item.imageUrls : []),
    ...(Array.isArray(item.additionalImages) ? item.additionalImages : []),
  ];

  return candidates.find((value) => typeof value === 'string' && value.trim()) || '';
};

const MiniCart = () => {
  const { cart, addToCart, removeFromCart, getCartTotal } = useCart();
  const [isCartOpen, setIsCartOpen] = useState(false);
  const wrapperRef = useRef(null);
  const closeButtonRef = useRef(null);

  const cartEntries = useMemo(() => {
    if (Array.isArray(cart)) {
      return cart.map((item, index) => [item.cartItemId || item.id || String(index), item]);
    }
    return Object.entries(cart || {});
  }, [cart]);

  const cartItemsCount = cartEntries.reduce(
    (total, [, item]) => total + (Number(item?.quantity ?? item?.qty) || 0),
    0
  );

  const total = useMemo(() => {
    if (typeof getCartTotal === 'function') return Number(getCartTotal()) || 0;
    return cartEntries.reduce(
      (sum, [, item]) => sum + (Number(item?.price) || 0) * (Number(item?.quantity ?? item?.qty) || 0),
      0
    );
  }, [getCartTotal, cartEntries]);

  const toggleCart = () => setIsCartOpen((open) => !open);
  const closeCart = () => setIsCartOpen(false);

  useEffect(() => {
    if (!isCartOpen) return undefined;

    const handlePointerDown = (event) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        closeCart();
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') closeCart();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    document.body.classList.add('mini-cart-is-open');

    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 80);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.classList.remove('mini-cart-is-open');
      window.clearTimeout(focusTimer);
    };
  }, [isCartOpen]);

  const handleQuantityChange = (item, delta) => {
    if (delta < 0) {
      const currentQuantity = Number(item?.quantity ?? item?.qty) || 0;
      // CartContext's removeFromCart removes one unit for existing cart item IDs.
      // If it removes the entire line, the same action still safely removes the item.
      if (currentQuantity > 0) removeFromCart(item.cartItemId || item.id);
    } else {
      addToCart(item);
    }
  };

  return (
    <div className="mini-cart-wrapper" ref={wrapperRef}>
      <button
        type="button"
        className={`mini-cart-icon ${isCartOpen ? 'is-active' : ''}`}
        onClick={toggleCart}
        aria-label={`Open shopping cart, ${cartItemsCount} items`}
        aria-expanded={isCartOpen}
        aria-haspopup="dialog"
      >
        <FaShoppingCart aria-hidden="true" />
        {cartItemsCount > 0 && (
          <span className="cart-item-count" key={cartItemsCount}>
            {cartItemsCount > 99 ? '99+' : cartItemsCount}
          </span>
        )}
        <span className="mini-cart-icon-glow" aria-hidden="true" />
      </button>

      <div
        className={`mini-cart-backdrop ${isCartOpen ? 'is-visible' : ''}`}
        aria-hidden="true"
      />

      <section
        className={`mini-cart-dropdown ${isCartOpen ? 'open' : ''}`}
        role="dialog"
        aria-modal="false"
        aria-label="Shopping cart"
        aria-hidden={!isCartOpen}
      >
        <div className="mini-cart-header">
          <div className="mini-cart-heading">
            <span className="mini-cart-kicker">YOUR SELECTION</span>
            <h3>Shopping bag <span>({cartItemsCount})</span></h3>
            <p>Thoughtfully chosen, ready for you.</p>
          </div>
          <button
            type="button"
            ref={closeButtonRef}
            onClick={closeCart}
            className="mini-cart-close-btn"
            aria-label="Close shopping cart"
            tabIndex={isCartOpen ? 0 : -1}
          >
            <FaTimes />
          </button>
        </div>

        {cartItemsCount > 0 ? (
          <>
            <div className="mini-cart-progress">
              <span className="mini-cart-progress-dot" />
              <span>You have {cartItemsCount} item{cartItemsCount === 1 ? '' : 's'} in your bag</span>
              <span className="mini-cart-progress-line" />
            </div>

            <ul className="mini-cart-items-list">
              {cartEntries.map(([cartItemId, item], index) => {
                const image = getItemImage(item);
                const quantity = Number(item?.quantity ?? item?.qty) || 0;
                const name = item?.productName || item?.title || item?.name || 'Product';
                const unitPrice = Number(item?.price) || 0;
                const variation = item?.variation;

                return (
                  <li
                    key={cartItemId}
                    className="mini-cart-item"
                    style={{ '--item-index': Math.min(index, 8) }}
                  >
                    <div className="mini-cart-item-image-wrap">
                      {image ? (
                        <img
                          src={image}
                          alt={name}
                          className="mini-cart-item-image"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <div className="mini-cart-item-image-placeholder" aria-label="No product image">
                          <FaShoppingCart aria-hidden="true" />
                        </div>
                      )}
                    </div>

                    <div className="mini-cart-item-details">
                      <p className="mini-cart-item-name">{name}</p>
                      {variation && (
                        <span className="mini-cart-variation">
                          {[variation.color, variation.size].filter(Boolean).join(' · ')}
                        </span>
                      )}
                      <span className="mini-cart-item-unit-price">{formatINR(unitPrice)} <small>/ unit</small></span>

                      <div className="mini-cart-quantity-controls" aria-label={`Quantity for ${name}`}>
                        <button
                          type="button"
                          onClick={() => handleQuantityChange(item, -1)}
                          aria-label={`Remove one ${name}`}
                        >
                          <FaMinus />
                        </button>
                        <span aria-live="polite">{quantity}</span>
                        <button
                          type="button"
                          onClick={() => handleQuantityChange(item, 1)}
                          aria-label={`Add one ${name}`}
                        >
                          <FaPlus />
                        </button>
                      </div>
                    </div>

                    <div className="mini-cart-item-price-actions">
                      <p className="mini-cart-item-price">{formatINR(unitPrice * quantity)}</p>
                      <button
                        type="button"
                        onClick={() => removeFromCart(cartItemId)}
                        className="mini-cart-remove-btn"
                        aria-label={`Remove ${name} from cart`}
                        title="Remove item"
                      >
                        <FaTrashAlt />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="mini-cart-summary">
              <div className="mini-cart-subtotal">
                <span>Subtotal</span>
                <span>{formatINR(total)}</span>
              </div>
              <p className="mini-cart-shipping-note">Shipping and discounts are calculated at checkout.</p>
              <div className="mini-cart-actions">
                <Link to="/cart" className="view-cart-btn" onClick={closeCart}>
                  View bag <FaArrowRight aria-hidden="true" />
                </Link>
                <Link to="/checkout" className="checkout-btn" onClick={closeCart}>
                  Continue to checkout <FaArrowRight aria-hidden="true" />
                </Link>
              </div>
              <div className="mini-cart-secure-note">
                <span className="mini-cart-secure-icon">✦</span>
                Secure checkout · Carefully packed
              </div>
            </div>
          </>
        ) : (
          <div className="mini-cart-empty">
            <div className="mini-cart-empty-icon">
              <FaRegHeart aria-hidden="true" />
            </div>
            <span className="mini-cart-kicker">A LITTLE SPACE FOR SOMETHING SPECIAL</span>
            <h4>Your bag is waiting</h4>
            <p>Discover pieces you’ll love and add them here.</p>
            <Link to="/collections" className="start-shopping-btn" onClick={closeCart}>
              Explore collection <FaArrowRight aria-hidden="true" />
            </Link>
          </div>
        )}
      </section>
    </div>
  );
};

export default MiniCart;
