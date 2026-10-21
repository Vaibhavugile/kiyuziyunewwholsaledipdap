import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  FiMenu,
  FiX,
  FiSearch,
  FiUser,
  FiHeart,
  FiShoppingCart,
  FiChevronDown,
} from "react-icons/fi";
import MiniCart from "./MiniCart";
import logo from "../assets/logoj.png";
import "./Navbar.css";
import { useAuth } from "./AuthContext";

const categories = [
  "Necklaces",
  "Earrings",
  "Bangles",
  "Bridal Sets",
  "Rings",
  "Mangalsutra",
  "Chains",
  "New Arrivals",
  "Best Sellers",
];

export default function Navbar() {
  const { currentUser, userRole, logout } = useAuth();
  const navigate = useNavigate();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const profileRef = useRef(null);
  const mobileMenuRef = useRef(null);

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (profileRef.current && !profileRef.current.contains(event.target)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setMobileOpen(false);
        setProfileOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    document.body.classList.toggle("kj-menu-open", mobileOpen);
    return () => document.body.classList.remove("kj-menu-open");
  }, [mobileOpen]);

  useEffect(() => {
    if (!mobileOpen || !mobileMenuRef.current) return;
    const firstControl = mobileMenuRef.current.querySelector("button, a");
    firstControl?.focus();
  }, [mobileOpen]);

  const closeMobileMenu = () => setMobileOpen(false);

  const handleSearch = (event) => {
    event.preventDefault();
    const query = searchText.trim();
    if (!query) return;
    navigate(`/?search=${encodeURIComponent(query)}`);
    closeMobileMenu();
  };

  const handleCategory = (category) => {
    navigate(`/?category=${encodeURIComponent(category)}`);
    closeMobileMenu();
  };

  const handleLogout = async () => {
    try {
      await logout();
      setProfileOpen(false);
      closeMobileMenu();
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  const renderAccountAction = (mobile = false) => {
    if (currentUser) {
      return (
        <div className={`kj-account-wrap ${mobile ? "is-mobile" : ""}`} ref={!mobile ? profileRef : undefined}>
          <button
            type="button"
            className={mobile ? "kj-mobile-action" : "kj-action"}
            onClick={() => mobile ? handleLogout() : setProfileOpen((open) => !open)}
            aria-label={mobile ? "Sign out" : "Open account menu"}
            aria-expanded={!mobile ? profileOpen : undefined}
          >
            <FiUser aria-hidden="true" />
            <span>{mobile ? "Sign out" : "Account"}</span>
          </button>
          {!mobile && profileOpen && (
            <div className="kj-profile-menu">
              {userRole === "admin" && (
                <Link to="/admin" className="kj-menu-item" onClick={() => setProfileOpen(false)}>
                  Admin dashboard
                </Link>
              )}
              <Link to="/order-history" className="kj-menu-item" onClick={() => setProfileOpen(false)}>
                My orders
              </Link>
              <button type="button" className="kj-menu-item" onClick={handleLogout}>
                Sign out
              </button>
            </div>
          )}
        </div>
      );
    }

    return (
      <Link
        to="/login"
        className={mobile ? "kj-mobile-action" : "kj-action"}
        onClick={closeMobileMenu}
        aria-label="Login to your account"
      >
        <FiUser aria-hidden="true" />
        <span>Account</span>
      </Link>
    );
  };

  return (
    <>
      <header className="kj-header">
        {/* Main utility row */}
        <div className="kj-main-row">
          <Link to="/" className="kj-brand" aria-label="Tanishka Wholesale Jewellery home">
            <img src={logo} alt="Tanishka jewellery logo" className="kj-logo" />
            <span className="kj-brand-copy">
              <span className="kj-brand-name">TANISHKA</span>
              <span className="kj-brand-tagline">RETAIL &amp; WHOLESALE JEWELLERY</span>
            </span>
          </Link>

          <form className="kj-search" role="search" onSubmit={handleSearch}>
            <input
              type="search"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Search for jewellery, collections, designs..."
              aria-label="Search jewellery"
            />
            {/* <button type="submit" aria-label="Search">
              <FiSearch aria-hidden="true" />
            </button> */}
          </form>

          <div className="kj-actions">
            {renderAccountAction()}

            <Link to="/wishlist" className="kj-action" aria-label="Wishlist">
              <FiHeart aria-hidden="true" />
              <span>Wishlist</span>
            </Link>

            <div className="kj-cart-action" aria-label="Shopping cart">
              <MiniCart />
            </div>

            <button
              type="button"
              className={`kj-hamburger ${mobileOpen ? "open" : ""}`}
              onClick={() => setMobileOpen((open) => !open)}
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileOpen}
              aria-controls="kj-mobile-menu"
            >
              {mobileOpen ? <FiX /> : <FiMenu />}
            </button>
          </div>
        </div>

        {/* Desktop category navigation */}
        <nav className="kj-category-nav" aria-label="Jewellery categories">
          <button type="button" className="kj-all-categories" onClick={() => handleCategory("All Categories")}>
            <FiMenu aria-hidden="true" />
            <span>All Categories</span>
            <FiChevronDown className="kj-chevron" aria-hidden="true" />
          </button>

          <div className="kj-category-links">
            {categories.map((category) => (
              <button key={category} type="button" onClick={() => handleCategory(category)}>
                {category}
              </button>
            ))}
          </div>

          <button type="button" className="kj-offers" onClick={() => handleCategory("Offers")}>
            <span className="kj-offer-icon">%</span>
            <span>Offers</span>
          </button>
        </nav>

        {/* Mobile search */}
        <form className="kj-mobile-search" role="search" onSubmit={handleSearch}>
          <input
            type="search"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Search for jewellery..."
            aria-label="Search jewellery"
          />
          <button type="submit" aria-label="Search">
            <FiSearch aria-hidden="true" />
          </button>
        </form>
      </header>

      <div
        className={`kj-mobile-backdrop ${mobileOpen ? "visible" : ""}`}
        onClick={closeMobileMenu}
        aria-hidden="true"
      />

      <aside
        id="kj-mobile-menu"
        ref={mobileMenuRef}
        className={`kj-mobile-menu ${mobileOpen ? "open" : ""}`}
        aria-hidden={!mobileOpen}
        aria-label="Mobile navigation menu"
      >
        <div className="kj-mobile-inner">
          <div className="kj-mobile-top">
            <Link to="/" className="kj-mobile-brand" onClick={closeMobileMenu}>
              <img src={logo} alt="" />
              <span>
                <strong>TANISHKA</strong>
                <small>RETAIL &amp; WHOLESALE JEWELLERY</small>
              </span>
            </Link>
            <button type="button" className="kj-mobile-close" onClick={closeMobileMenu} aria-label="Close menu">
              <FiX />
            </button>
          </div>

          <div className="kj-mobile-account-row">
            {renderAccountAction(true)}
            <Link to="/wishlist" className="kj-mobile-action" onClick={closeMobileMenu}>
              <FiHeart aria-hidden="true" />
              <span>Wishlist</span>
            </Link>
            <Link to="/order-history" className="kj-mobile-action" onClick={closeMobileMenu}>
              <FiShoppingCart aria-hidden="true" />
              <span>My Orders</span>
            </Link>
          </div>

          <nav className="kj-mobile-nav" aria-label="Mobile jewellery categories">
            <button type="button" className="kj-mobile-all" onClick={() => handleCategory("All Categories")}>
              <span><FiMenu aria-hidden="true" /> All Categories</span>
              <FiChevronDown aria-hidden="true" />
            </button>
            {categories.map((category) => (
              <button type="button" key={category} onClick={() => handleCategory(category)}>
                {category}
              </button>
            ))}
            <button type="button" className="kj-mobile-offers" onClick={() => handleCategory("Offers")}>
              <span className="kj-offer-icon">%</span> Offers
            </button>
            {userRole === "admin" && (
              <Link to="/admin" onClick={closeMobileMenu}>Admin Dashboard</Link>
            )}
            <Link to="/contact" onClick={closeMobileMenu}>Contact Us</Link>
          </nav>

          <div className="kj-mobile-wholesale">
            <span className="kj-wholesale-kicker">FOR RETAILERS &amp; BOUTIQUES</span>
            <strong>Discover wholesale jewellery</strong>
            <p>Explore elegant designs for your business.</p>
            <span className="kj-minimum-order">Minimum order value ₹2,500</span>
          </div>

          <div className="kj-mobile-footer">
            <span>Delivering elegance across India</span>
            {!currentUser && (
              <Link to="/login" className="kj-mobile-login" onClick={closeMobileMenu}>
                Login to view wholesale prices
              </Link>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
