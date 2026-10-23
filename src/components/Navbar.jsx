import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase.js";
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
import "./Navbar.css";
import { useAuth } from "./AuthContext";

export default function Navbar() {
  const { currentUser, userRole, logout } = useAuth();
  const navigate = useNavigate();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [categories, setCategories] = useState([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const profileRef = useRef(null);
  const mobileMenuRef = useRef(null);

  // Read the category records prepared in settings/productCategories.
  // Navbar only displays the saved data; it does not scan products or write to Firestore.
  useEffect(() => {
    let cancelled = false;

    const loadSavedCategories = async () => {
      setCategoriesLoading(true);

      try {
        const categoriesRef = doc(db, "settings", "productCategories");
        const snapshot = await getDoc(categoriesRef);
        const savedCategories = snapshot.exists()
          ? snapshot.data()?.categories
          : [];

        const normalized = Array.isArray(savedCategories)
          ? savedCategories
              .filter((item) => item && item.isActive !== false)
              .map((item) => {
                // Support both the newer collection-like objects and older string entries.
                if (typeof item === "string") {
                  const title = item.trim();
                  return title ? { id: title.toLowerCase(), title, name: title } : null;
                }

                const title = String(item.title || item.name || item.category || "").trim();
                if (!title) return null;

                return {
                  ...item,
                  id: item.id || item.categoryId || item.categorySlug || item.slug || title.toLowerCase(),
                  title,
                  name: item.name || title,
                  category: item.category || title,
                  image: item.image || item.imageUrl || "",
                  imageUrl: item.imageUrl || item.image || "",
                  additionalImages: Array.isArray(item.additionalImages)
                    ? item.additionalImages
                    : [],
                };
              })
              .filter(Boolean)
          : [];

        // De-duplicate by normalized title while retaining the full saved category object.
        const unique = [
          ...new Map(
            normalized.map((item) => [
              String(item.title).trim().toLocaleLowerCase(),
              item,
            ])
          ).values(),
        ].sort(
          (a, b) =>
            (Number(a.showNumber) || 999999) - (Number(b.showNumber) || 999999) ||
            a.title.localeCompare(b.title, undefined, { sensitivity: "base" })
        );

        if (!cancelled) setCategories(unique);
      } catch (error) {
        console.error("Failed to load categories from settings/productCategories:", error);
        if (!cancelled) setCategories([]);
      } finally {
        if (!cancelled) setCategoriesLoading(false);
      }
    };

    loadSavedCategories();

    return () => {
      cancelled = true;
    };
  }, []);

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
  const slug = String(category)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");

  navigate(`/category/${encodeURIComponent(slug)}`);
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
          <Link to="/" className="kj-brand" aria-label="Everything Wholesale Market home">
            <span className="kj-logo-mark" aria-hidden="true">E</span>
            <span className="kj-brand-copy">
              <span className="kj-brand-name">EVERYTHING</span>
              <span className="kj-brand-tagline">WHOLESALE MARKET</span>
            </span>
          </Link>

          <form className="kj-search" role="search" onSubmit={handleSearch}>
            <input
              type="search"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Search products, categories, brands..."
              aria-label="Search products"
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
        <nav className="kj-category-nav" aria-label="Product categories">
          <button type="button" className="kj-all-categories" onClick={() => handleCategory("All Categories")}>
            <FiMenu aria-hidden="true" />
            <span>All Categories</span>
            <FiChevronDown className="kj-chevron" aria-hidden="true" />
          </button>

          <div className="kj-category-links">
            {categoriesLoading ? (
              <span className="kj-category-loading" aria-live="polite">Loading categories…</span>
            ) : categories.map((category) => (
              <button
                key={category.id}
                type="button"
                onClick={() => handleCategory(category.title)}
                title={category.title}
              >
                {category.title}
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
            aria-label="Search products"
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
              <span className="kj-logo-mark" aria-hidden="true">E</span>
              <span>
                <strong>EVERYTHING</strong>
                <small>WHOLESALE MARKET</small>
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

          <nav className="kj-mobile-nav" aria-label="Mobile product categories">
            <button type="button" className="kj-mobile-all" onClick={() => handleCategory("All Categories")}>
              <span><FiMenu aria-hidden="true" /> All Categories</span>
              <FiChevronDown aria-hidden="true" />
            </button>
            {categoriesLoading ? (
              <span className="kj-category-loading" aria-live="polite">Loading categories…</span>
            ) : categories.map((category) => (
              <button
                type="button"
                key={category.id}
                onClick={() => handleCategory(category.title)}
              >
                {category.title}
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
            <span className="kj-wholesale-kicker">FOR RETAILERS &amp; BULK BUYERS</span>
            <strong>Everything you need, wholesale prices.</strong>
            <p>Explore everyday essentials, home products, beauty, fashion and more.</p>
            <span className="kj-minimum-order">Minimum order value ₹2,500</span>
          </div>

          <div className="kj-mobile-footer">
            <span>Delivering wholesale value across India</span>
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
