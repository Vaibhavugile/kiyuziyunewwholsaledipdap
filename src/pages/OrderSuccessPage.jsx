import React from 'react';
import { Link } from 'react-router-dom';
import './OrderSuccessPage.css';

const OrderSuccessPage = () => {
  return (
    <main className="order-success-page">
      <div className="order-success-shell">
        <div className="order-success-confetti" aria-hidden="true">
          {Array.from({ length: 18 }, (_, index) => (
            <span key={index} className={`order-success-confetti-piece order-success-confetti-piece-${index % 6}`} />
          ))}
        </div>

        <section className="order-success-card" aria-labelledby="order-success-title">
          <div className="order-success-brand-mark" aria-hidden="true">
            <span className="order-success-brand-sparkle">✦</span>
          </div>

          <div className="order-success-check-wrap" aria-hidden="true">
            <svg className="order-success-check-svg" viewBox="0 0 88 88" role="presentation">
              <circle className="order-success-check-circle" cx="44" cy="44" r="39" />
              <path className="order-success-check-path" d="M25 45.5 37.5 58 63 31.5" />
            </svg>
            <span className="order-success-check-glow" />
          </div>

          <p className="order-success-eyebrow"><span /> ORDER RECEIVED <span /></p>
          <h1 id="order-success-title" className="order-success-title">
            A little joy<br />
            <em>is on its way.</em>
          </h1>
          <p className="order-success-message">
            Thank you for choosing us. Your order has been placed successfully.
            Our team will contact you shortly with the next steps.
          </p>

          <div className="order-success-status">
            <span className="order-success-status-icon" aria-hidden="true">✓</span>
            <div>
              <strong>Order confirmation in progress</strong>
              <p>Keep an eye on your phone for an update from our team.</p>
            </div>
          </div>

          <div className="order-success-divider"><span>✦</span></div>

          <div className="order-success-next-steps">
            <div className="order-success-next-step">
              <span className="order-success-step-number">01</span>
              <div><strong>We review your order</strong><p>Our team checks the details.</p></div>
            </div>
            <div className="order-success-next-step">
              <span className="order-success-step-number">02</span>
              <div><strong>We get in touch</strong><p>We’ll share the next steps.</p></div>
            </div>
          </div>

          <Link to="/" className="order-success-continue-btn">
            <span>Continue shopping</span>
            <span className="order-success-continue-arrow" aria-hidden="true">↗</span>
          </Link>

          <p className="order-success-footer-note">
            Made with care, selected just for you.
          </p>
        </section>

        <footer className="order-success-page-footer">
          <span>THANK YOU FOR YOUR ORDER</span>
          <span className="order-success-footer-star" aria-hidden="true">✦</span>
          <span>WE’RE GLAD YOU’RE HERE</span>
        </footer>
      </div>
    </main>
  );
};

export default OrderSuccessPage;
