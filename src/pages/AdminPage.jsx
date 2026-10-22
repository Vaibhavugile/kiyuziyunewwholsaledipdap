import React, { useState, useEffect, useRef } from 'react';
import {
  db,
  collection,
  getDocs,
  addDoc,
  
  updateDoc,
  deleteDoc,
  doc,
  storage,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
  getDoc,
  query,
  where,
  serverTimestamp,
  writeBatch,
  setDoc,

} from '../firebase';
import { onSnapshot } from "firebase/firestore";
import CollectionCard from '../components/CollectionCard';
import ProductCard from '../components/ProductCard';
import OrderDetailsModal from '../components/OrderDetailsModal';
import { getPriceForQuantity, getCartItemId, useCart, createStablePricingId } from '../components/CartContext';
import './AdminPage.css';
import './OfflineBillingGST.css';
import './QuickAddProduct.css';
import './AdminProductEditLayout.css';
import './DeoDapProductEditor.css';
import './SaasUsers.css';
import ReactCrop from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { useNavigate } from 'react-router-dom';
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { ROLE_CONFIG } from "../config/roles";
import { useMemo } from 'react';
import {
  Html5QrcodeScanner,
  Html5QrcodeSupportedFormats
} from "html5-qrcode";

import { Html5Qrcode } from "html5-qrcode";
import { auth } from "../firebase"; // adjust path


// Low stock threshold constant
const LOW_STOCK_THRESHOLD = 10;

// CSV parser that supports quoted fields and commas inside quoted values.
const parseProductImportCsv = (text) => {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      row.push(value.trim());
      value = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(value.trim());
      if (row.some(cell => cell !== '')) rows.push(row);
      row = [];
      value = '';
    } else {
      value += char;
    }
  }
  row.push(value.trim());
  if (row.some(cell => cell !== '')) rows.push(row);
  if (rows.length < 2) return [];
  const headers = rows[0].map(header => header.replace(/^\uFEFF/, '').trim().toLowerCase());
  return rows.slice(1).map(cells => headers.reduce((item, header, index) => {
    item[header] = cells[index] ?? '';
    return item;
  }, {}));
};

// Keep product codes as strings so codes such as "0510" retain leading zeroes.
// DeoDap SKUs commonly follow the importer convention: CODE_product_name.
const normalizeProductCode = (value) => String(value ?? '').trim().toLowerCase();

const getDeoDapCodeFromSku = (value) => {
  const sku = String(value ?? '').trim();
  if (!sku) return '';
  const match = sku.match(/^([^_\s-]+)[_-]/);
  return match ? match[1].trim() : '';
};

const getDeoDapRecordCode = (record) => {
  const skuCandidates = [
    record?.sku,
    record?.inventoryRow?.sku,
    ...(Array.isArray(record?.variants) ? record.variants.map(variant => variant?.sku) : []),
    ...(Array.isArray(record?.variant_details) ? record.variant_details.map(variant => variant?.sku) : []),
  ];
  for (const sku of skuCandidates) {
    const code = getDeoDapCodeFromSku(sku);
    if (code) return code;
  }
  const inventoryName = String(record?.inventoryRow?.inventoryName ?? record?.inventory_name ?? '').trim();
  return getDeoDapCodeFromSku(inventoryName);
};

// Compress scraped product images in-browser before uploading. Images are resized
// to at most 1000px and encoded as WebP to reduce Firebase Storage usage/bandwidth.
const compressProductImage = async (file, maxDimension = 1000, quality = 0.72) => {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Could not create image compression canvas.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        result => result ? resolve(result) : reject(new Error('Image compression failed.')),
        'image/webp',
        quality
      );
    });
    return blob;
  } finally {
    bitmap.close?.();
  }
};

const formatFileSize = (bytes = 0) => {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const safeStorageSegment = (value) => String(value || 'unknown')
  .trim()
  .replace(/[\\#?%:*"<>|]/g, '-')
  .replace(/\s+/g, '-')
  .slice(0, 120);

const AdminPage = () => {
  // State for Main Collections
  const [mainCollections, setMainCollections] = useState([]);
  const [mainCollectionName, setMainCollectionName] = useState('');
  const [mainCollectionImageFile, setMainCollectionImageFile] = useState(null);
  const [mainCollectionShowNumber, setMainCollectionShowNumber] = useState('');
  const [isMainCollectionLoading, setIsMainCollectionLoading] = useState(true);
  const [isMainCollectionUploading, setIsMainCollectionUploading] = useState(false);
  const [editingMainCollection, setEditingMainCollection] = useState(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isCropping, setIsCropping] = useState(false);
  const [imageToCrop, setImageToCrop] = useState(null);
  const [mainCollectionAdditionalImages, setMainCollectionAdditionalImages] = useState([]);
  const [allProductsMap, setAllProductsMap] = useState({});

const [productDestination, setProductDestination] = useState("");
  const ROLE_KEYS = Object.keys(ROLE_CONFIG);
  const PRICING_KEYS = ROLE_KEYS.map(
    role => ROLE_CONFIG[role].pricingKey
  );
  const [subcollectionsMap, setSubcollectionsMap] = useState({});


  // State for Subcollections
  const [selectedMainCollectionId, setSelectedMainCollectionId] = useState('');
  const [subcollections, setSubcollections] = useState([]);
  const [subcollectionName, setSubcollectionName] = useState('');
  const [subcollectionDescription, setSubcollectionDescription] = useState('');
  const [subcollectionImageFile, setSubcollectionImageFile] = useState(null);
  const [subcollectionShowNumber, setSubcollectionShowNumber] = useState('');
  const [subcollectionPurchaseRate, setSubcollectionPurchaseRate] = useState('');
  const [isSubcollectionLoading, setIsSubcollectionLoading] = useState(false);
  const [isSubcollectionUploading, setIsSubcollectionUploading] = useState(false);
  const [editingSubcollection, setEditingSubcollection] = useState(null);
  // 🔥 Barcode scan input
  const barcodeInputRef = useRef(null);
  const [scannedBarcode, setScannedBarcode] = useState("");
  const [lastScannedProduct, setLastScannedProduct] = useState(null);

  const [showCameraScanner, setShowCameraScanner] = useState(false);
  const html5QrCodeRef = useRef(null);
  const [isScanMode, setIsScanMode] = useState(false);
  const [currentUserRole, setCurrentUserRole] = useState(null);
  const [roleLoading, setRoleLoading] = useState(true);
const [variantSelectionProduct, setVariantSelectionProduct] = useState(null);

  const emptyPricing = PRICING_KEYS.reduce((acc, key) => {
    acc[key] = [];
    return acc;
  }, {});

  const [subcollectionTieredPricing, setSubcollectionTieredPricing] =
    useState(emptyPricing);

  const navigate = useNavigate();

  // State for Products
  const [selectedSubcollectionId, setSelectedSubcollectionId] = useState('');
  const [products, setProducts] = useState([]);
  const [allCollectionProducts, setAllCollectionProducts] = useState([]);
  const [editProductRetailPrice, setEditProductRetailPrice] = useState('');
  const [editProductGstRate, setEditProductGstRate] = useState('0');
  const [editProductGstType, setEditProductGstType] = useState('exclusive');
  // DeoDap catalog fields are additive: legacy inventory/pricing fields remain intact.
  const [deodapRawJson, setDeodapRawJson] = useState('');
  const [deodapRawData, setDeodapRawData] = useState({});
  const [deodapScrapedCatalog, setDeodapScrapedCatalog] = useState([]);
  const [deodapFolderName, setDeodapFolderName] = useState('');
  const [deodapMatchSearch, setDeodapMatchSearch] = useState({});
  const [deodapSelectedMatch, setDeodapSelectedMatch] = useState({});
  const [deodapFolderLoading, setDeodapFolderLoading] = useState(false);
  const [deodapConnectingId, setDeodapConnectingId] = useState(null);
  const [deodapBulkConnecting, setDeodapBulkConnecting] = useState(false);
  const [deodapConnectionStatus, setDeodapConnectionStatus] = useState({});
  const [deodapConnectionReport, setDeodapConnectionReport] = useState(null);
  const [deodapImageUploading, setDeodapImageUploading] = useState(false);
  const [deodapImageProgress, setDeodapImageProgress] = useState({ current: 0, total: 0, uploaded: 0, matched: 0, failed: 0, skipped: 0, currentSku: '' });
  const [deodapImageFolderName, setDeodapImageFolderName] = useState('');
  const [deodapImageSizeReport, setDeodapImageSizeReport] = useState({ originalBytes: 0, compressedBytes: 0, imageCount: 0, compressedCount: 0 });
  const [deodapFields, setDeodapFields] = useState({
    sku: '', tags: '', compareAtPrice: '', discountPercentage: '', vendor: '',
    productType: '', descriptionHtml: '', descriptionText: '', keyFeatures: '', faqs: '[]',
    source: 'deodap.in', productUrl: '', handle: '', available: true, origin: '', currency: 'INR', scrapedAt: '', sourceImageUrls: '',
  });
  const updateDeodapField = (field, value) => setDeodapFields(prev => ({ ...prev, [field]: value }));

  const [productName, setProductName] = useState(''); // New state for product name
  const [productCode, setProductCode] = useState('');
  const [productQuantity, setProductQuantity] = useState('');
  const [editingProduct, setEditingProduct] = useState(null);
  const [isProductLoading, setIsProductLoading] = useState(false);
  const [isProductUploading, setIsProductUploading] = useState(false);
  const [showProductForm, setShowProductForm] = useState(false);
  const [selectedSubcollectionData, setSelectedSubcollectionData] = useState(null);
  const [productEntryMode, setProductEntryMode] = useState('quick');
  const [quickProductName, setQuickProductName] = useState('');
  const [quickProductCode, setQuickProductCode] = useState('');
  const [quickProductQuantity, setQuickProductQuantity] = useState('');
  const [quickProductPurchaseRate, setQuickProductPurchaseRate] = useState('');
  const [quickProductRetailPrice, setQuickProductRetailPrice] = useState('');
  const [quickProductGstRate, setQuickProductGstRate] = useState('0');
  const [quickProductGstType, setQuickProductGstType] = useState('exclusive');
  const [editProductPrices, setEditProductPrices] = useState(() => PRICING_KEYS.reduce((acc, key) => ({ ...acc, [key]: '' }), {}));
  const [editProductPurchaseRate, setEditProductPurchaseRate] = useState('');
  const [quickProductImage, setQuickProductImage] = useState(null);
  const [quickProductImagePreview, setQuickProductImagePreview] = useState('');
  const [productImportFile, setProductImportFile] = useState(null);
  const [productImportRows, setProductImportRows] = useState([]);
  const [productImportError, setProductImportError] = useState('');
  const [isProductImporting, setIsProductImporting] = useState(false);
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [userOrderStats, setUserOrderStats] = useState({});

  // New state for multi-photo product upload
  const [newProducts, setNewProducts] = useState([]);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [additionalImages, setAdditionalImages] = useState([]);
  const [productVariations, setProductVariations] = useState([]);
  const [newVariation, setNewVariation] = useState({ color: '', size: '', quantity: '' });


  // New states for Orders and Low Stock Alerts
  const [activeTab, setActiveTab] = useState('collections');
  const [activeSubTab, setActiveSubTab] = useState('collections'); // New state for sub-tabs
  const [orders, setOrders] = useState([]);
  const [isOrderLoading, setIsOrderLoading] = useState(false);
  const [lowStockProducts, setLowStockProducts] = useState([]);
  const [isLowStockLoading, setIsLowStockLoading] = useState(false);
  const [trashProgress, setTrashProgress] = useState(0);
  const [trashRunning, setTrashRunning] = useState(false);

  // States for modal display
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [selectedLowStockProduct, setSelectedLowStockProduct] = useState(null);

  // NEW: States for order search and date filtering
  const [orderSearchTerm, setOrderSearchTerm] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');

  // New states for User Management
  const [users, setUsers] = useState([]);
  const [isUserLoading, setIsUserLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // NEW: State for search and filter
  const [productSearchTerm, setProductSearchTerm] = useState('');
  const [groupedOrders, setGroupedOrders] = useState({});

  const [orderReports, setOrderReports] = useState([]);
  const [paymentReports, setPaymentReports] = useState([]);
  const [isReportsLoading, setIsReportsLoading] = useState(false);
  const [productReports, setProductReports] = useState([]);
  const [sendInvoiceOnWhatsApp, setSendInvoiceOnWhatsApp] = useState(false);
  const [offlinePaymentMethod, setOfflinePaymentMethod] = useState("Cash");
  const [isAudioUnlocked, setIsAudioUnlocked] = useState(false);
  const SHIPPING_CHARGE = 199;
const [isShippingApplied, setIsShippingApplied] = useState(false);
  useEffect(() => {
    const fetchUserRole = async () => {
      const user = auth.currentUser;

      if (!user) return;

      try {
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
          setCurrentUserRole(userSnap.data().role);
        }
      } catch (error) {
        console.error("Error fetching user role:", error);
      }

      setRoleLoading(false);
    };

    fetchUserRole();
  }, []);
  // 🔊 Scanner Sounds
  const readySound = new Audio("/sounds/scanner-ready.mp3");
  const successSound = new Audio("/sounds/scan-success.mp3");
  const errorSound = new Audio("/sounds/scan-error.mp3");
  readySound.volume = 0.5;   // softer
  successSound.volume = 1;   // loud beep
  errorSound.volume = 0.8;
  // medium
  useEffect(() => {
    const unlockAudio = () => {
      if (isAudioUnlocked) return;

      const temp = new Audio("/sounds/scan-success.mp3");
      temp.volume = 0;
      temp.play().catch(() => { });

      setIsAudioUnlocked(true);
      console.log("🔓 Audio unlocked");
    };

    window.addEventListener("click", unlockAudio);
    window.addEventListener("keydown", unlockAudio);

    return () => {
      window.removeEventListener("click", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };
  }, [isAudioUnlocked]);


  const playSound = (file) => {
    if (!isAudioUnlocked) return;

    try {
      const sound = new Audio(file);
      sound.volume = 1;

      sound.play().catch((err) => {
        console.log("Play blocked:", err);
      });
    } catch (err) {
      console.log("Sound error:", err);
    }
  };


  const [isScannerReadyPlayed, setIsScannerReadyPlayed] = useState(false);


  const [userFilters, setUserFilters] = useState({
    name: '',
    mobile: '',
    address: '',
    role: '',
    minOrders: '',
    maxOrders: '',
    minAmount: '',
    maxAmount: '',
    lastOrderFrom: '',
    lastOrderTo: '',
    createdFrom: '',
    createdTo: '',
  });
  const handleUserFilterChange = (key, value) => {
    setUserFilters(prev => ({
      ...prev,
      [key]: value,
    }));
  };

  // State for Offline Billing
  const [offlineCollections, setOfflineCollections] = useState([]);
  const [selectedOfflineCollectionId, setSelectedOfflineCollectionId] = useState('');
  const [offlineSubcollections, setOfflineSubcollections] = useState([]);
  const [selectedOfflineSubcollectionId, setSelectedOfflineSubcollectionId] = useState('');
  const [offlineProducts, setOfflineProducts] = useState([]);
  const [offlineCart, setOfflineCart] = useState({});
  const [offlinePricingKey, setOfflinePricingKey] = useState('retail');

  const [isOfflineProductsLoading, setIsOfflineProductsLoading] = useState(false);
  const [offlineSubtotal, setOfflineSubtotal] = useState(0);
  const [pricedOfflineCart, setPricedOfflineCart] = useState({});
  const [userSearchColumn, setUserSearchColumn] = useState('name');
  const [userSearchValue, setUserSearchValue] = useState('');
  const [userSortField, setUserSortField] = useState('createdAt');
  const [userSortOrder, setUserSortOrder] = useState('desc'); // asc | desc
  const [offlineCustomer, setOfflineCustomer] = useState({
    fullName: '',
    email: '',
    phoneNumber: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    pincode: '',
    gst: '',
  });

  const [isGSTApplied, setIsGSTApplied] = useState(false);
  const [showInvoice, setShowInvoice] = useState(false);
  const [invoiceData, setInvoiceData] = useState(null);
  const [isCartPreviewReceipt, setIsCartPreviewReceipt] = useState(false);

  // Add this line with your other useState calls at the top of the component:
  const [offlineSelections, setOfflineSelections] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  // Add this line to your other useState declarations
  const [editedTotal, setEditedTotal] = useState('');
  const [crop, setCrop] = useState();
  const [imageSrc, setImageSrc] = useState(null);
  const [completedCrop, setCompletedCrop] = useState(null);
  const imgRef = useRef(null);
  const [modalImage, setModalImage] = useState(null);
  const openImageModal = (imageUrl) => {
    if (imageUrl) {
      setModalImage(imageUrl);
    }
  };

  // 3. Handler to close the modal
  const closeImageModal = () => {
    setModalImage(null);
  };

  const formatOrderDate = (timestamp) => {
    if (!timestamp) return 'N/A';

    let orderDate;

    // 🔥 SAFE conversion
    if (typeof timestamp.toDate === 'function') {
      orderDate = timestamp.toDate(); // Firestore Timestamp
    } else if (timestamp instanceof Date) {
      orderDate = timestamp; // JS Date
    } else {
      orderDate = new Date(timestamp); // string / number fallback
    }

    if (isNaN(orderDate.getTime())) return 'N/A';

    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    // Normalize dates (strip time)
    const orderDay = new Date(
      orderDate.getFullYear(),
      orderDate.getMonth(),
      orderDate.getDate()
    );
    const todayDay = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate()
    );
    const yesterdayDay = new Date(
      yesterday.getFullYear(),
      yesterday.getMonth(),
      yesterday.getDate()
    );

    if (orderDay.getTime() === todayDay.getTime()) {
      return 'Today';
    }

    if (orderDay.getTime() === yesterdayDay.getTime()) {
      return 'Yesterday';
    }

    return orderDate.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };
  const getSafeDate = (timestamp) => {
    if (!timestamp) return null;

    // Firestore Timestamp
    if (typeof timestamp.toDate === 'function') {
      return timestamp.toDate();
    }

    // JS Date
    if (timestamp instanceof Date) {
      return timestamp;
    }

    // String / number fallback
    const d = new Date(timestamp);
    return isNaN(d.getTime()) ? null : d;
  };


  // Handlers for Tiered Pricing (now for Subcollections)
  const handleAddTier = (type) => {
    setSubcollectionTieredPricing((prevPricing) => {
      const existingTiers = Array.isArray(prevPricing[type])
        ? prevPricing[type]
        : [];

      return {
        ...prevPricing,
        [type]: [
          ...existingTiers,
          { min_quantity: "", max_quantity: "", price: "" }
        ],
      };
    });
  };

  const onCropComplete = (crop) => {
    setCompletedCrop(crop);
  };
  const handleOfflineSelectionChange = (productId, variationObject) => {
    // This updates the selected variation for a specific product
    setOfflineSelections(prev => ({
      ...prev,
      [productId]: variationObject
    }));
  };
  // NOTE: You must have getCartItemId and getPriceForOfflineBilling (or similar) available in this file's scope.
  const handleOfflineCustomerChange = (field, value) => {
    setOfflineCustomer(prev => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleOfflineAddToCart = (product, variation = null, incrementBy = 1) => {

    // 1. Determine the item's unique ID based on product and variation
    const itemToAdd = { ...product, variation: variation || product.variation };
    const cartItemId = getCartItemId(itemToAdd);

    // 2. Determine available stock for the selected variant
    // Use the stock from the passed variation object, or fallback to the product's base quantity
    const availableStock = variation
      ? Number(variation.quantity)
      : (itemToAdd.variation ? Number(itemToAdd.variation.quantity) : Number(product.quantity || 0));

    const currentQuantityInCart = offlineCart[cartItemId]?.quantity || 0;

    // 3. Stock Check: Prevent adding if the limit is reached
    if (currentQuantityInCart >= availableStock) {
      console.warn(`Cannot add item: Max stock reached for ${product.productName} (${availableStock}).`);
      // Optional: You could show a UI alert here
      return;
    }

    // 4. Update the cart state
    setOfflineCart(prevCart => {
      const existingItem = prevCart[cartItemId];

      // Item enrichment: Save the availableStock and the variation
      const itemToSave = {
        ...itemToAdd,
        productDocumentId: product.productDocumentId || product.id,
        destination: product.destination || 'products',
        productCode: String(product.productCode || '').trim(),
        id: cartItemId,
        price: getPriceForOfflineBilling(itemToAdd, offlinePricingKey),
        availableStock,
        gstRate: parseFloat(product.gstRate ?? product.gst_rate ?? 0) || 0,
        gstType: product.gstType ?? product.gst_type ?? 'exclusive',
      };

      if (existingItem) {
        // Increment logic
        return {
          ...prevCart,
          [cartItemId]: {
            ...existingItem,
            quantity: existingItem.quantity + incrementBy,
          }
        };
      } else {
        // New item logic
        return {
          ...prevCart,
          [cartItemId]: {
            ...itemToSave,
            quantity: 1, // Add one item
          }
        };
      }
    });
  };
  const convertNumberToWords = (num) => {
    // You can plug any library here later
    return num.toLocaleString('en-IN');
  };

  // --- NEW UTILITY FUNCTION for Offline Billing ---
  const getPriceForOfflineBilling = (item, offlinePricingKey) => {
    // 1. Determine the pricing tiers to use based on the selected type (retail/wholesale)
    // NOTE: This assumes the product object already has a structure like:
    // item.tieredPricing.wholesale and item.tieredPricing.retail, or that 
    // you are passing a pre-calculated tieredPricing prop/object if needed.

    const productTiers = item.tieredPricing; // Assuming item has this structure

    if (!productTiers) {
      // Fallback: Use base price from the product/variation if no tiers are available
      return item.variation?.price || item.price || 0;
    }

    const tiers = offlinePricingKey === 'wholesale'
      ? productTiers.wholesale
      : productTiers.retail;

    if (!tiers || tiers.length === 0) {
      return item.variation?.price || item.price || 0;
    }

    // 2. Use the smallest quantity tier price (since we are adding 1 at a time, we use the base price)
    // NOTE: In the offline selection panel, we only care about the base price for display.
    // The getPriceForQuantity function (imported from CartContext) should find the correct price.

    // For simplicity in the selection panel, we usually display the base price (tier 1).
    // The lowest quantity tier is the one with the smallest min_quantity.
    const baseTier = [...tiers].sort((a, b) => a.min_quantity - b.min_quantity)[0];

    // For the cart, the price should be calculated for the *current* quantity (item.quantity).
    // Since this function is used when adding the item *to* the cart, and also when refreshing the price, 
    // we should usually just return the base price for the selection panel, or the price for quantity 1.

    // Using quantity 1 to get the base price
    return getPriceForQuantity(tiers, 1) || baseTier.price || item.price || 0;
  };
  const handleRemoveTier = (type, index) => {
    setSubcollectionTieredPricing((prevPricing) => ({
      ...prevPricing,
      [type]: prevPricing[type].filter((_, i) => i !== index),
    }));
  };


  const fetchOrders = async () => {
    try {
      const ordersSnapshot = await getDocs(collection(db, "orders"));
      const ordersList = ordersSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        // Ensure timestamps are handled correctly for sorting
        createdAt: doc.data().createdAt?.toDate() || new Date(),
      }));

      // Sort orders by creation date, descending
      ordersList.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      // Group orders by formatted date
      const groups = ordersList.reduce((acc, order) => {
        const dateKey = formatOrderDate(order.createdAt);
        if (!acc[dateKey]) {
          acc[dateKey] = [];
        }
        acc[dateKey].push(order);
        return acc;
      }, {});

      setGroupedOrders(groups);
      setOrders(ordersList);
    } catch (error) {
      console.error("Error fetching orders: ", error);
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      await fetchMainCollections();
      await fetchSubcollections();
      await fetchProducts();
      await fetchOrders();
    };
    fetchData();
  }, []);

  const openOrderModal = (order) => {
    setSelectedOrder(order);
    setShowOrderModal(true);
  };
  

  const closeOrderModal = () => {
    setShowOrderModal(false);
    setSelectedOrder(null);
  };
  useEffect(() => {
    const stats = {};

    orders.forEach(order => {
      const userId = order.userId;
      if (!userId || !order.createdAt) return;

      // 🚫 Ignore cancelled orders
      if (order.status === 'Cancelled') return;

      const orderDate = getSafeDate(order.createdAt);

      const amount = Number(order.totalAmount) || 0;
      const profit = Number(order.orderProfit) || 0; // 🔥 PRECOMPUTED

      if (!stats[userId]) {
        stats[userId] = {
          lastOrderDate: orderDate,
          totalOrders: 0,
          lifetimeValue: 0,
          lifetimeProfit: 0, // 🔥 ADD THIS
        };
      }

      stats[userId].totalOrders += 1;
      stats[userId].lifetimeValue += amount;
      stats[userId].lifetimeProfit += profit;

      if (orderDate > stats[userId].lastOrderDate) {
        stats[userId].lastOrderDate = orderDate;
      }
    });

    setUserOrderStats(stats);
  }, [orders]);

  useEffect(() => {
    console.log('User Order Stats:', userOrderStats);
  }, [userOrderStats]);

  // Product-wise GST: inclusive prices already contain tax; exclusive prices add tax to the bill.
  const getProductGstDetails = (item, lineTotal) => {
    const rate = Math.max(0, parseFloat(item?.gstRate ?? item?.gst_rate ?? 0) || 0);
    const rawType = String(item?.gstType ?? item?.gst_type ?? 'exclusive').toLowerCase();
    const inclusive = rawType.includes('inclusive') || rawType.includes('included') || rawType === 'incl';
    const tax = inclusive
      ? (rate > 0 ? Number(lineTotal || 0) * rate / (100 + rate) : 0)
      : Number(lineTotal || 0) * rate / 100;
    return { rate, type: inclusive ? 'inclusive' : 'exclusive', tax, addedTax: inclusive ? 0 : tax };
  };

  const offlineGstSummary = Object.values(pricedOfflineCart).reduce((summary, item) => {
    const unitPrice = Number(item.calculatedPrice ?? item.price ?? 0) || 0;
    const lineTotal = unitPrice * (Number(item.quantity) || 0);
    const details = getProductGstDetails(item, lineTotal);
    summary.taxAmount += details.tax;
    summary.addedTax += details.addedTax;
    summary.includedTax += details.type === 'inclusive' ? details.tax : 0;
    return summary;
  }, { taxAmount: 0, addedTax: 0, includedTax: 0 });

  const baseTotal = editedTotal !== '' ? Math.max(0, Number(editedTotal) || 0) : Number(offlineSubtotal);
  const gstAmount = offlineGstSummary.taxAmount;
  const shippingValue = isShippingApplied ? SHIPPING_CHARGE : 0;
  const finalTotal = baseTotal + offlineGstSummary.addedTax + shippingValue;

  const handleTierChange = (type, index, field, value) => {
    setSubcollectionTieredPricing((prevPricing) => {
      const updatedTiers = [...prevPricing[type]];
      updatedTiers[index] = { ...updatedTiers[index], [field]: value };
      return { ...prevPricing, [type]: updatedTiers };
    });
  };
  useEffect(() => {
    if (showInvoice && invoiceData && !isCartPreviewReceipt) {
      // Small delay ensures DOM + styles are fully rendered
      const timer = setTimeout(() => {
        window.print();
      }, 300);

      return () => clearTimeout(timer);
    }
  }, [showInvoice, invoiceData, isCartPreviewReceipt]);

  // --- Utility Functions ---
  const handleImageChange = (e, setImageFile) => {
    if (e.target.files[0]) {
      setImageFile(e.target.files[0]);
    }
  };

  const uploadImageAndGetURL = async (imageFile) => {
    if (!imageFile) return null;
    const storageRef = ref(storage, `images/${Date.now()}-${imageFile.name}`);
    const snapshot = await uploadBytes(storageRef, imageFile);
    return await getDownloadURL(snapshot.ref);
  };

  const deleteImageFromStorage = async (imageUrl) => {
    if (!imageUrl) return;
    try {
      const imageRef = ref(storage, imageUrl);
      await deleteObject(imageRef);
    } catch (error) {
      console.error('Error deleting image from storage:', error);
    }
  };
const [isCartInitialized, setIsCartInitialized] = useState(false);

/* =========================
   RESTORE CART ON LOAD
========================= */
useEffect(() => {
  const savedCart = localStorage.getItem("offlineCartDraft");

  if (savedCart) {
    try {
      const parsedCart = JSON.parse(savedCart);
      setOfflineCart(parsedCart);
      console.log("📦 Draft restored:", parsedCart);
    } catch (error) {
      console.error("❌ Failed to restore cart:", error);
      localStorage.removeItem("offlineCartDraft");
    }
  }

  // Mark initialization complete
  setIsCartInitialized(true);
}, []);


/* =========================
   SAVE CART AFTER CHANGES
========================= */
useEffect(() => {
  if (!isCartInitialized) return; // 🚫 Prevent first render overwrite

  localStorage.setItem(
    "offlineCartDraft",
    JSON.stringify(offlineCart)
  );

  console.log("💾 Draft saved:", offlineCart);
}, [offlineCart, isCartInitialized]);
  // --- Fetch Main Collections ---
  const fetchMainCollections = async () => {
    setIsMainCollectionLoading(true);
    try {
      const querySnapshot = await getDocs(collection(db, 'collections'));
      const fetched = querySnapshot.docs.map((doc) => ({
        ...doc.data(),
        id: doc.id,
      }));
      setMainCollections(fetched.sort((a, b) => a.showNumber - b.showNumber));
    } catch (error) {
      console.error('Error fetching main collections:', error);
    }
    setIsMainCollectionLoading(false);
  };

  // --- Fetch Subcollections for Selected Main Collection ---
  const fetchSubcollections = async () => {
    if (!selectedMainCollectionId) {
      setSubcollections([]);
      return;
    }
    setIsSubcollectionLoading(true);
    try {
      const subcollectionRef = collection(db, 'collections', selectedMainCollectionId, 'subcollections');
      const querySnapshot = await getDocs(subcollectionRef);
      const fetched = querySnapshot.docs.map((doc) => ({
        ...doc.data(),
        id: doc.id,
      }));
      setSubcollections(fetched.sort((a, b) => a.showNumber - b.showNumber));
    } catch (error) {
      console.error('Error fetching subcollections:', error);
    }
    setIsSubcollectionLoading(false);
  };

  const handleAdditionalImageChange = (e) => {
    const files = Array.from(e.target.files);
    setAdditionalImages(files.map(file => ({
      file,
      previewUrl: URL.createObjectURL(file),
    })));
  };

  // --- Fetch Products for Selected Subcollection ---
  const fetchProducts = async () => {
    if (!selectedMainCollectionId || !selectedSubcollectionId) {
      setProducts([]);
      setSelectedSubcollectionData(null);
      return;
    }
    setIsProductLoading(true);
    try {
      const subcollectionDocRef = doc(db, 'collections', selectedMainCollectionId, 'subcollections', selectedSubcollectionId);
      const subcollectionDocSnap = await getDoc(subcollectionDocRef);
      if (subcollectionDocSnap.exists()) {
        setSelectedSubcollectionData({ id: subcollectionDocSnap.id, ...subcollectionDocSnap.data() });
      } else {
        setSelectedSubcollectionData(null);
      }

      const productPath = ['collections', selectedMainCollectionId, 'subcollections', selectedSubcollectionId];
      const [websiteSnapshot, appSnapshot] = await Promise.all([
        getDocs(collection(db, ...productPath, 'products')),
        getDocs(collection(db, ...productPath, 'appProducts')),
      ]);
      const fetched = [
        ...websiteSnapshot.docs.map((productDoc) => ({ ...productDoc.data(), id: productDoc.id, destination: 'products' })),
        ...appSnapshot.docs.map((productDoc) => ({ ...productDoc.data(), id: productDoc.id, destination: 'appProducts' })),
      ];
      setProducts(fetched);
    } catch (error) {
      console.error('Error fetching products:', error);
    }
    setIsProductLoading(false);
  };

  // Fetch all products for the selected collection concurrently instead of waiting
  // for each subcollection one by one. This reduces total loading time substantially.
  const fetchAllCollectionProducts = async (collectionId = selectedMainCollectionId) => {
    if (!collectionId) {
      setAllCollectionProducts([]);
      return;
    }

    setIsProductLoading(true);
    try {
      const subsSnap = await getDocs(collection(db, 'collections', collectionId, 'subcollections'));
      const subDocs = subsSnap.docs;

      // Fetch both product destinations for every subcollection in parallel.
      const productGroups = await Promise.all(subDocs.map(async (subDoc) => {
        const subcollectionData = { id: subDoc.id, ...subDoc.data() };
        const base = ['collections', collectionId, 'subcollections', subDoc.id];
        const [websiteSnap, appSnap] = await Promise.all([
          getDocs(collection(db, ...base, 'products')),
          getDocs(collection(db, ...base, 'appProducts')),
        ]);

        const mapProduct = (productDoc, destination) => {
          const data = productDoc.data();
          return {
            ...data,
            id: productDoc.id,
            destination,
            subcollectionId: subDoc.id,
            subcollectionName: subcollectionData.name || 'Unnamed subcollection',
            subcollectionData,
            purchasePrice: data.purchasePrice ?? data.purchaseRate ?? subcollectionData.purchasePrice ?? subcollectionData.purchaseRate ?? 0,
            purchaseRate: data.purchaseRate ?? data.purchasePrice ?? subcollectionData.purchaseRate ?? subcollectionData.purchasePrice ?? 0,
            retailPrice: data.retailPrice ?? data.salePrice ?? data.price ?? subcollectionData.retailPrice ?? subcollectionData.salePrice ?? subcollectionData.price ?? 0,
            salePrice: data.salePrice ?? data.retailPrice ?? data.price ?? subcollectionData.salePrice ?? subcollectionData.retailPrice ?? subcollectionData.price ?? 0,
            gstRate: data.gstRate ?? data.gst_rate ?? subcollectionData.gstRate ?? 0,
            gstType: data.gstType ?? data.gst_type ?? subcollectionData.gstType ?? 'exclusive',
            quantity: data.quantity ?? data.current_stock ?? subcollectionData.quantity ?? subcollectionData.current_stock ?? 0,
          };
        };

        return [
          ...websiteSnap.docs.map((d) => mapProduct(d, 'products')),
          ...appSnap.docs.map((d) => mapProduct(d, 'appProducts')),
        ];
      }));

      // Ignore stale responses if the admin switched collections while loading.
      if (collectionId === selectedMainCollectionId) {
        setAllCollectionProducts(productGroups.flat());
      }
    } catch (error) {
      console.error('Error fetching all products for collection:', error);
      alert('Could not load all products for this collection. Check the console for details.');
    } finally {
      setIsProductLoading(false);
    }
  };

  // UseEffects to trigger data fetching on dependency changes
  useEffect(() => {
    fetchMainCollections();
  }, []);

  useEffect(() => {
    fetchSubcollections();
    setSelectedSubcollectionId('');
    setAllCollectionProducts([]);
    setShowProductForm(false);
    setEditingProduct(null);
  }, [selectedMainCollectionId]);

  useEffect(() => {
    fetchProducts();
  }, [selectedSubcollectionId, selectedMainCollectionId]);

  useEffect(() => {
    if (activeSubTab === 'products' && productEntryMode === 'manage' && selectedMainCollectionId) fetchAllCollectionProducts();
    else if (!selectedMainCollectionId) setAllCollectionProducts([]);
  }, [selectedMainCollectionId, productEntryMode, activeSubTab]);

  // New: Fetches all orders
  useEffect(() => {
  if (activeTab !== "orders") return;

  setIsOrderLoading(true);

  const ordersCollectionRef = collection(db, "orders");

  const unsubscribe = onSnapshot(
    ordersCollectionRef,
    (snapshot) => {
      const fetchedOrders = snapshot.docs.map((doc) => ({
        ...doc.data(),
        id: doc.id,
      }));

      setOrders(fetchedOrders);
      setIsOrderLoading(false);
    },
    (error) => {
      console.error("Error listening to orders:", error);
      setIsOrderLoading(false);
    }
  );

  return () => unsubscribe();
}, [activeTab]);
  // NEW: Filtered orders based on search and date range
  // Updated: Filtered orders based on search, date, and now status
  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      // Search filter logic
      const searchTerm = orderSearchTerm.toLowerCase();

      const matchesSearch =
        order.id.toLowerCase().includes(searchTerm) ||
        (order.billingInfo?.fullName || '').toLowerCase().includes(searchTerm) ||
        (order.billingInfo?.email || '').toLowerCase().includes(searchTerm) ||
        (order.billingInfo?.phoneNumber || '').toLowerCase().includes(searchTerm);

      // Date filter logic
      const orderDate = getSafeDate(order.createdAt);

      const isAfterStartDate = startDate
        ? orderDate >= new Date(startDate)
        : true;

      const isBeforeEndDate = endDate
        ? orderDate <= new Date(endDate)
        : true;

      // Status filter logic
      const matchesStatus =
        statusFilter === 'All' || order.status === statusFilter;

      return (
        matchesSearch &&
        isAfterStartDate &&
        isBeforeEndDate &&
        matchesStatus
      );
    });
  }, [orders, orderSearchTerm, startDate, endDate, statusFilter]);
  const groupedOrdersFromFiltered = useMemo(() => {
    return filteredOrders.reduce((acc, order) => {
      const dateKey = formatOrderDate(order.createdAt);

      if (!acc[dateKey]) {
        acc[dateKey] = [];
      }

      acc[dateKey].push(order);
      return acc;
    }, {});
  }, [filteredOrders]);
  const sortedDateKeys = useMemo(() => {
    const keys = Object.keys(groupedOrdersFromFiltered);

    return keys.sort((a, b) => {
      if (a === 'Today') return -1;
      if (b === 'Today') return 1;
      if (a === 'Yesterday') return -1;
      if (b === 'Yesterday') return 1;

      // Other dates: newest first
      return new Date(b) - new Date(a);
    });
  }, [groupedOrdersFromFiltered]);


  // New: Fetches low stock products
  useEffect(() => {
    const fetchLowStockProducts = async () => {
      if (activeTab === 'lowStock') {
        setIsLowStockLoading(true);
        const allLowStockProducts = [];

        // Loop through all main collections and subcollections to find products
        for (const mainCol of mainCollections) {
          const subcollectionRef = collection(db, "collections", mainCol.id, "subcollections");
          const subcollectionSnapshot = await getDocs(subcollectionRef);

          for (const subCol of subcollectionSnapshot.docs) {
            const productsRef = collection(db, "collections", mainCol.id, "subcollections", subCol.id, "products");
            // Use a query to filter for low stock items
            const q = query(productsRef, where("quantity", "<=", LOW_STOCK_THRESHOLD));
            const productsSnapshot = await getDocs(q);

            productsSnapshot.forEach(productDoc => {
              allLowStockProducts.push({
                ...productDoc.data(),
                id: productDoc.id,
                mainCollectionName: mainCol.name,
                subcollectionName: subCol.data().name,
              });
            });
          }
        }
        setLowStockProducts(allLowStockProducts);
        setIsLowStockLoading(false);
      }
    };
    fetchLowStockProducts();
  }, [activeTab, mainCollections]);

  // New: Fetches all users for admin management
  const fetchUsers = async () => {
    if (activeTab === 'users') {
      setIsUserLoading(true);
      try {
        const querySnapshot = await getDocs(collection(db, 'users'));
        const fetchedUsers = querySnapshot.docs.map((doc) => ({
          ...doc.data(),
          id: doc.id,
        }));
        setUsers(fetchedUsers);
      } catch (error) {
        console.error('Error fetching users:', error);
      }
      setIsUserLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [activeTab]);
  // useEffect(() => {
  //   if (activeTab === 'orders') {
  //     fetchOrders();
  //   }
  //   if (activeTab === 'users') {
  //     fetchUsers();
  //   }
  //   if (activeTab === 'collections') {
  //     fetchMainCollections();
  //   }
  //   if (activeTab === 'offline-billing') {
  //     fetchMainCollectionsForOffline();
  //   }
  // }, [activeTab]);
  useEffect(() => {
    if (selectedOfflineCollectionId) {
      fetchSubcollectionsForOffline(selectedOfflineCollectionId);
      setOfflineProducts([]); // Clear products when collection changes
      setSelectedOfflineSubcollectionId('');
    }
  }, [selectedOfflineCollectionId]);

  useEffect(() => {
    if (selectedOfflineSubcollectionId) {
      fetchOfflineProducts(selectedOfflineSubcollectionId);
    }
  }, [selectedOfflineSubcollectionId]);

  const handleDownloadLowStockImages = async () => {
    setIsDownloading(true);
    try {
      for (const product of lowStockProducts) {
        if (product.image) {
          const response = await fetch(product.image);
          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.style.display = 'none';
          a.href = url;
          a.download = `low_stock_${product.productCode}.jpg`; // Customize filename
          document.body.appendChild(a);
          a.click();
          window.URL.revokeObjectURL(url);
          document.body.removeChild(a);
        }
      }
    } catch (error) {
      console.error("Error downloading images:", error);
      alert("Failed to download one or more images.");
    } finally {
      setIsDownloading(false);
    }
  };


  // New: Function to handle updating order status
  const handleUpdateOrderStatus = async (orderId, newStatus) => {
    try {
      const orderRef = doc(db, 'orders', orderId);
      await updateDoc(orderRef, {
        status: newStatus,
      });
      setOrders(prevOrders => prevOrders.map(order =>
        order.id === orderId ? { ...order, status: newStatus } : order
      ));
      alert("Order status updated successfully!");
    } catch (error) {
      console.error("Error updating order status:", error);
      alert("Failed to update order status.");
    }
  };

  // New: Function to update a user's role
  const handleUpdateUserRole = async (userId, newRole) => {
    if (window.confirm(`Are you sure you want to change this user's role to '${newRole}'?`)) {
      try {
        const userRef = doc(db, 'users', userId);
        await updateDoc(userRef, { role: newRole });
        fetchUsers(); // Refresh the user list
        alert('User role updated successfully!');
      } catch (error) {
        console.error('Error updating user role:', error);
        alert('Failed to update user role.');
      }
    }
  };

  // New: Function to delete a user
 const handleDeleteUser = async (userId) => {
  const confirmDelete = window.confirm(
    "Are you sure you want to delete this user?"
  );

  if (!confirmDelete) return;

  const password = window.prompt(
    "Enter admin password to delete this user:"
  );

  if (password === null) return; // User cancelled

  if (password !== "Reddy@2002") {
    alert("Incorrect password.");
    return;
  }

  try {
    await deleteDoc(doc(db, "users", userId));

    await fetchUsers();

    alert("User deleted successfully!");
  } catch (error) {
    console.error("Error deleting user:", error);
    alert("Failed to delete user.");
  }
};
  const handleMainCollectionAdditionalImagesChange = (e) => {
    const files = Array.from(e.target.files || []);

    setMainCollectionAdditionalImages(
      files.map(file => ({
        file,
        previewUrl: URL.createObjectURL(file),
      }))
    );
  };

  // --- Main Collection Handlers ---
  const handleAddMainCollection = async (e) => {
    e.preventDefault();

    if (!mainCollectionName || !mainCollectionImageFile || !mainCollectionShowNumber) {
      alert('Please fill out all fields.');
      return;
    }

    setIsMainCollectionUploading(true);

    try {
      /* ---------- UPLOAD MAIN IMAGE ---------- */
      const mainImageUrl = await uploadImageAndGetURL(mainCollectionImageFile);

      /* ---------- UPLOAD ADDITIONAL IMAGES ---------- */
      const uploadedAdditionalImages = [];

      for (const img of mainCollectionAdditionalImages) {
        if (img.file) {
          const url = await uploadImageAndGetURL(img.file);
          uploadedAdditionalImages.push(url);
        }
      }

      await addDoc(collection(db, 'collections'), {
        title: mainCollectionName,
        image: mainImageUrl,
        additionalImages: uploadedAdditionalImages,
        showNumber: parseInt(mainCollectionShowNumber, 10),
        createdAt: serverTimestamp(),
      });

      fetchMainCollections();
      resetMainCollectionForm();
    } catch (error) {
      console.error('Error adding main collection:', error);
      alert('Failed to add main collection.');
    } finally {
      setIsMainCollectionUploading(false);
    }
  };


  const startEditMainCollection = (item) => {
    setEditingMainCollection(item);
    setMainCollectionName(item.title);
    setMainCollectionShowNumber(item.showNumber);

    setMainCollectionAdditionalImages(
      (item.additionalImages || []).map(url => ({
        previewUrl: url,
      }))
    );
  };


  const handleUpdateMainCollection = async (e) => {
    e.preventDefault();
    if (!editingMainCollection) return;

    setIsMainCollectionUploading(true);

    try {
      let mainImageUrl = editingMainCollection.image;

      /* ---------- REPLACE MAIN IMAGE IF CHANGED ---------- */
      if (mainCollectionImageFile) {
        await deleteImageFromStorage(editingMainCollection.image);
        mainImageUrl = await uploadImageAndGetURL(mainCollectionImageFile);
      }

      /* ---------- HANDLE ADDITIONAL IMAGES ---------- */
      const existingAdditional = mainCollectionAdditionalImages
        .filter(img => !img.file)
        .map(img => img.previewUrl);

      const newUploads = [];

      for (const img of mainCollectionAdditionalImages) {
        if (img.file) {
          const url = await uploadImageAndGetURL(img.file);
          newUploads.push(url);
        }
      }

      const allAdditionalImages = [...existingAdditional, ...newUploads];

      await updateDoc(
        doc(db, 'collections', editingMainCollection.id),
        {
          title: mainCollectionName,
          image: mainImageUrl,
          additionalImages: allAdditionalImages,
          showNumber: parseInt(mainCollectionShowNumber, 10),
          updatedAt: serverTimestamp(),
        }
      );

      fetchMainCollections();
      resetMainCollectionForm();
    } catch (error) {
      console.error('Error updating main collection:', error);
      alert('Failed to update main collection.');
    } finally {
      setIsMainCollectionUploading(false);
    }
  };


  const handleDeleteMainCollection = async (item) => {
    if (!window.confirm('Delete this collection and all its data?')) return;

    try {
      const urlsToDelete = [
        item.image,
        ...(item.additionalImages || []),
      ];

      for (const url of urlsToDelete) {
        if (url) {
          await deleteObject(ref(storage, url));
        }
      }

      await deleteDoc(doc(db, 'collections', item.id));
      fetchMainCollections();
    } catch (err) {
      console.error('Error deleting main collection:', err);
      alert('Failed to delete collection.');
    }
  };

  const generateInvoicePDFBlob = async () => {
    const element = document.getElementById("invoice-pdf");
    if (!element) return null;
    const canvas = await html2canvas(element, {
      scale: 3,
      backgroundColor: "#ffffff",
      useCORS: true,
      windowWidth: element.scrollWidth,
    });
    const imgData = canvas.toDataURL("image/png");
    const pdfWidth = 80;
    const pdfHeight = Math.max(80, (canvas.height * pdfWidth) / canvas.width);
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: [pdfWidth, pdfHeight], compress: true });
    pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight, undefined, "FAST");
    return pdf.output("blob");
  };

  const downloadInvoicePDF = async () => {
    try {
      const blob = await generateInvoicePDFBlob();
      if (!blob) throw new Error("Receipt is not ready yet.");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `Receipt-${invoiceData?.invoiceNumber || "offline-sale"}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (error) {
      console.error("Receipt PDF download failed:", error);
      alert("Could not download the receipt PDF. Please try again.");
    }
  };

  const uploadInvoicePDF = async (orderId) => {
    const pdfBlob = await generateInvoicePDFBlob();
    if (!pdfBlob) return null;

    const pdfRef = ref(storage, `invoices/${orderId}.pdf`);
    await uploadBytes(pdfRef, pdfBlob);

    const downloadURL = await getDownloadURL(pdfRef);
    return downloadURL;
  };


  const resetMainCollectionForm = () => {
    setMainCollectionName('');
    setMainCollectionImageFile(null);
    setMainCollectionShowNumber('');
    setEditingMainCollection(null);
  };

  // --- Subcollection Handlers ---

  const handleAddSubcollection = async (e) => {
    e.preventDefault();

    // ✅ BASIC REQUIRED FIELDS CHECK
    if (
      !selectedMainCollectionId ||
      !subcollectionName ||
      !subcollectionPurchaseRate ||
      !subcollectionImageFile ||
      !subcollectionShowNumber
    ) {
      alert('Please fill out all required fields.');
      return;
    }

    // ✅ ROLE-AGNOSTIC PRICING VALIDATION (IMPORTANT FIX)
    const hasPricing = Object.values(subcollectionTieredPricing)
      .some(tiers => Array.isArray(tiers) && tiers.length > 0);

    if (!hasPricing) {
      alert('Add at least one pricing tier.');
      return;
    }

    setIsSubcollectionUploading(true);

    try {
      const imageUrl = await uploadImageAndGetURL(subcollectionImageFile);

      const subcollectionRef = collection(
        db,
        'collections',
        selectedMainCollectionId,
        'subcollections'
      );

      const newDoc = await addDoc(subcollectionRef, {
        name: subcollectionName,
        description: subcollectionDescription,
        image: imageUrl,
        showNumber: parseInt(subcollectionShowNumber, 10),
        purchaseRate: parseFloat(subcollectionPurchaseRate),
        tieredPricing: subcollectionTieredPricing,
        createdAt: serverTimestamp(),
      });

      console.log('Subcollection added with ID:', newDoc.id);
      fetchSubcollections();
    } catch (error) {
      console.error('Error adding subcollection:', error);
      alert('Failed to add subcollection.');
    } finally {
      setIsSubcollectionUploading(false);
      resetSubcollectionForm();
    }
  };

  const startEditSubcollection = (item) => {
    setEditingSubcollection(item);
    setSubcollectionName(item.name || '');
    setSubcollectionDescription(item.description || '');
    setSubcollectionShowNumber(item.showNumber || '');
    setSubcollectionPurchaseRate(item.purchaseRate || '');

    // ✅ SAFE DEFAULT FOR MULTI-ROLE PRICING
    setSubcollectionTieredPricing(item.tieredPricing || {});
  };

  const handleUpdateSubcollection = async (e) => {
    e.preventDefault();
    if (!editingSubcollection) return;

    // ✅ ROLE-AGNOSTIC PRICING VALIDATION (SAME AS ADD)
    const hasPricing = Object.values(subcollectionTieredPricing)
      .some(tiers => Array.isArray(tiers) && tiers.length > 0);

    if (!hasPricing) {
      alert('Add at least one pricing tier.');
      return;
    }

    setIsSubcollectionUploading(true);

    let imageUrl = editingSubcollection.image;

    try {
      if (subcollectionImageFile) {
        await deleteImageFromStorage(editingSubcollection.image);
        imageUrl = await uploadImageAndGetURL(subcollectionImageFile);
      }

      const docRef = doc(
        db,
        'collections',
        selectedMainCollectionId,
        'subcollections',
        editingSubcollection.id
      );

      await updateDoc(docRef, {
        name: subcollectionName,
        description: subcollectionDescription,
        image: imageUrl,
        showNumber: parseInt(subcollectionShowNumber, 10),
        purchaseRate: parseFloat(subcollectionPurchaseRate),
        tieredPricing: subcollectionTieredPricing,
        updatedAt: serverTimestamp(),
      });

      console.log('Subcollection updated successfully');
      fetchSubcollections();
    } catch (error) {
      console.error('Error updating subcollection:', error);
      alert('Failed to update subcollection.');
    } finally {
      setIsSubcollectionUploading(false);
      resetSubcollectionForm();
    }
  };

  const handleDeleteSubcollection = async (id, imageUrl) => {
    if (!window.confirm('Are you sure you want to delete this subcollection and all its products?')) {
      return;
    }

    try {
      await deleteImageFromStorage(imageUrl);

      const docRef = doc(
        db,
        'collections',
        selectedMainCollectionId,
        'subcollections',
        id
      );

      await deleteDoc(docRef);
      fetchSubcollections();
    } catch (error) {
      console.error('Error deleting subcollection:', error);
      alert('Failed to delete subcollection.');
    }
  };

  const resetSubcollectionForm = () => {
    setSubcollectionName('');
    setSubcollectionDescription('');
    setSubcollectionImageFile(null);
    setSubcollectionShowNumber('');
    setSubcollectionPurchaseRate('');
    setSubcollectionTieredPricing({});
    setEditingSubcollection(null);
  };

  // --- Product Handlers ---
  const handleProductImageChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      const products = files.map(file => {
        return {
          productName: '',
          productCode: '',
          quantity: '',
          imageFile: file,
          previewUrl: URL.createObjectURL(file),
        };
      });
      setNewProducts(products);
      setCurrentImageIndex(0);
      setShowProductForm(true); // Directly show the form
    }
  };

  // Opens the cropper with the selected image
  const startCropping = (imageUrl) => {
    setImageToCrop(imageUrl);
    setCrop(undefined);
    setIsCropping(true);
  };

  // Handles the cropping action and updates the product in state
  const getCroppedImage = () => {
    if (!imgRef.current || !completedCrop) {
      return;
    }

    const image = imgRef.current;
    const canvas = document.createElement('canvas');
    const scaleX = image.naturalWidth / image.width;
    const scaleY = image.naturalHeight / image.height;

    canvas.width = completedCrop.width;
    canvas.height = completedCrop.height;
    const ctx = canvas.getContext('2d');

    ctx.drawImage(
      image,
      completedCrop.x * scaleX,
      completedCrop.y * scaleY,
      completedCrop.width * scaleX,
      completedCrop.height * scaleY,
      0,
      0,
      completedCrop.width,
      completedCrop.height
    );

    canvas.toBlob((blob) => {
      const croppedFile = new File([blob], 'cropped-image.png', { type: 'image/png' });

      // Create a new array to update the state immutably
      const updatedProducts = [...newProducts];

      // Find the index of the product being edited or the current one being added
      const indexToUpdate = editingProduct ? newProducts.findIndex(p => p.id === editingProduct.id) : currentImageIndex;

      // Update the image file and preview URL for the correct product
      if (indexToUpdate !== -1) {
        updatedProducts[indexToUpdate] = {
          ...updatedProducts[indexToUpdate],
          imageFile: croppedFile,
          previewUrl: URL.createObjectURL(croppedFile),
        };
        setNewProducts(updatedProducts);
      }

      // Hide the cropper and return to the form
      setIsCropping(false);
      setImageToCrop(null);
      setCompletedCrop(null);
    }, 'image/png');
  };
  // Add this function to your component's logic
  const handleDeleteNewImage = (indexToDelete) => {
    // Create a new array without the image to be deleted
    const updatedNewProducts = newProducts.filter((_, index) => index !== indexToDelete);

    // If the deleted image was the last one, reset the form.
    if (updatedNewProducts.length === 0) {
      resetProductForm();
      setShowProductForm(false);
    } else {
      // Update the state with the new array
      setNewProducts(updatedNewProducts);
      // If we deleted an image and there are still images left,
      // we need to make sure the current index is valid.
      // If the last image was deleted, the index should be adjusted.
      if (currentImageIndex >= updatedNewProducts.length) {
        setCurrentImageIndex(updatedNewProducts.length - 1);
      }
    }
  };

  // Handler for new variation input
  const handleNewVariationChange = (e) => {
    const { name, value } = e.target;
    setNewVariation(prev => ({ ...prev, [name]: value }));
  };

  // Handler for adding a variation to the list
  const handleAddVariation = () => {
    // Ensure at least one field has data before adding
    if (newVariation.color || newVariation.size || newVariation.quantity) {
      setProductVariations(prev => [...prev, newVariation]);
      setNewVariation({ color: '', size: '', quantity: '' }); // Reset the input fields
    }
  };

  // Handler for removing a variation
  const handleRemoveVariation = (indexToRemove) => {
    setProductVariations(prev => prev.filter((_, index) => index !== indexToRemove));
  };
  const handleNextProduct = (e) => {
    e.preventDefault();

    // Check for product name and code
    if (!productName || !productCode) {
      alert("Please fill out product name and product code.");
      return;
    }

    // Check if either a single quantity or at least one variation has been added
    if (productVariations.length === 0 && productQuantity === '') {
      alert("Please enter a quantity or add at least one variation.");
      return;
    }

    const updatedProducts = [...newProducts];

    // Create an array of images including the main one and any additional uploads
    const images = [{
      file: updatedProducts[currentImageIndex].imageFile,
      previewUrl: updatedProducts[currentImageIndex].previewUrl,
    }, ...additionalImages];

    updatedProducts[currentImageIndex].productName = productName;
    updatedProducts[currentImageIndex].productCode = productCode;

    // Store either the single quantity or the variations
    if (productVariations.length > 0) {
      updatedProducts[currentImageIndex].variations = productVariations;
    } else {
      updatedProducts[currentImageIndex].quantity = Number(productQuantity);
    }

    updatedProducts[currentImageIndex].images = images; // Save the array of images

    setNewProducts(updatedProducts);

    // Reset fields for the next product
    setProductName('');
    setProductCode('');
    setProductQuantity('');
    setAdditionalImages([]);

    // Reset the variation-specific states
    setProductVariations([]);
    setNewVariation({ color: '', size: '', quantity: '' });

    setCurrentImageIndex(currentImageIndex + 1);
  };
  const autoEnableForDropshippers = async (productId, productData, targetSubcollectionId = selectedSubcollectionId) => {

  const settingsSnap = await getDocs(collection(db, "dropshipperSettings"));

  for (const settingDoc of settingsSnap.docs) {

    const userId = settingDoc.id;
    const data = settingDoc.data();

    const key = `${selectedMainCollectionId}_${targetSubcollectionId}`;

    // Skip if autoEnable not enabled for this subcollection
    if (!data?.autoEnable?.[key]) continue;

    const batch = writeBatch(db);

    /* dropshipperProducts */

    const dropshipperRef = doc(
      db,
      "dropshipperProducts",
      userId,
      "products",
      productId
    );

    batch.set(dropshipperRef, {
      productId,
      collectionId: selectedMainCollectionId,
      subcollectionId: targetSubcollectionId,
      enabled: true,
      updatedAt: Date.now()
    });

    /* storeProducts */

    const storeRef = doc(
      db,
      "storeProducts",
      userId,
      "products",
      productId
    );

    batch.set(storeRef, {
      productId,
      productName: productData.productName,
      productCode: productData.productCode,
      image: productData.image,
      collectionId: selectedMainCollectionId,
      subcollectionId: targetSubcollectionId,
      enabled: true,
      updatedAt: Date.now()
    });

    await batch.commit();
  }
};
  const handleAddAllProducts = async (e) => {
        e.preventDefault();

    if (!productDestination) {
  alert("Please select where you want to upload the product.");
  return;
}
    setIsProductUploading(true);

    try {
const productCollectionRef = collection(
  db,
  "collections",
  selectedMainCollectionId,
  "subcollections",
  selectedSubcollectionId,
  productDestination
);

      const batch = writeBatch(db);

      for (const product of newProducts) {
        // Safety check
        if (!product.productName || !product.productCode) {
          console.error("Skipping product with missing name/code:", product);
          continue;
        }

        /* -----------------------------------------
           STEP 1: UPLOAD ALL IMAGES (MAIN + EXTRA)
        ------------------------------------------ */
        const uploadedImageUrls = [];

        for (const img of product.images || []) {
          if (img.file) {
            const url = await uploadImageAndGetURL(img.file);
            uploadedImageUrls.push(url);
          }
        }

        // Split images
        const mainImageUrl = uploadedImageUrls[0] || "";
        const additionalImageUrls = uploadedImageUrls.slice(1);

        /* -----------------------------------------
           STEP 2: HANDLE VARIATIONS / QUANTITY
        ------------------------------------------ */
        let finalVariations = [];
        let totalQuantity = 0;

        if (product.variations && product.variations.length > 0) {
          finalVariations = product.variations.map(v => ({
            color: v.color || "",
            size: v.size || "",
            quantity: Number(v.quantity) || 0,
          }));

          totalQuantity = finalVariations.reduce(
            (sum, v) => sum + v.quantity,
            0
          );
        } else {
          totalQuantity = Number(product.quantity) || 0;
          finalVariations = [];
        }

        /* -----------------------------------------
           STEP 3: PREPARE PRODUCT DATA (🔥 IMPORTANT)
        ------------------------------------------ */
        const productData = {
          productName: product.productName,
          productCode: product.productCode,

          image: mainImageUrl,                      // ✅ main image
          additionalImages: additionalImageUrls,    // ✅ REQUIRED BY ProductCard

          quantity: totalQuantity,
            initialQuantity: totalQuantity, 
  variations: finalVariations.map(v => ({
    ...v,
    initialQuantity: v.quantity      // ✅ SAVE INITIAL VARIANT STOCK
  })),
          mainCollection: selectedMainCollectionId,
          createdAt: serverTimestamp(),
        };

        console.log("Saving product:", productData);

       const newDocRef = doc(productCollectionRef);
batch.set(newDocRef, productData);

/* SAVE PRODUCT ID FOR AUTO ENABLE */

product.autoEnableId = newDocRef.id;
product.autoEnableData = productData;
      }

      await batch.commit();

/* AUTO ENABLE FOR DROPSHIPPERS */

for (const product of newProducts) {

  if (product.autoEnableId) {

    await autoEnableForDropshippers(
      product.autoEnableId,
      product.autoEnableData
    );

  }

}

      alert("All products added successfully!");
      fetchProducts();
      resetProductForm();

      // Cleanup
      setNewProducts([]);
      setProductVariations([]);
      setNewVariation({ color: "", size: "", quantity: "" });

    } catch (err) {
      console.error("Error adding products:", err);
      alert("Failed to save products.");
    } finally {
      setIsProductUploading(false);
    }
  };


  // Quick-add flow: one product creates one subcollection and keeps pricing in
  // the same tieredPricing shape used by the existing storefront/cart logic.
  const handleQuickAddProduct = async (e) => {
    e.preventDefault();
    if (!selectedMainCollectionId) {
      alert('Please select a main collection.');
      return;
    }
    if (!quickProductImage || !quickProductName.trim() || !quickProductCode.trim()) {
      alert('Please add a product image, name, and product code.');
      return;
    }
    if (quickProductQuantity === '' || Number(quickProductQuantity) < 0) {
      alert('Please enter a valid stock quantity.');
      return;
    }
    if (!quickProductPurchaseRate || Number(quickProductPurchaseRate) < 0) {
      alert('Please enter a valid purchase rate.');
      return;
    }
    if (!productDestination) {
      alert('Please select Website or Mobile App.');
      return;
    }
    if (quickProductRetailPrice === '' || !Number.isFinite(Number(quickProductRetailPrice)) || Number(quickProductRetailPrice) < 0) {
      alert('Please enter a valid retail price.');
      return;
    }

    setIsProductUploading(true);
    let uploadedImageUrl = '';
    try {
      uploadedImageUrl = await uploadImageAndGetURL(quickProductImage);
      if (!uploadedImageUrl) throw new Error('Product image upload failed.');

      const subcollectionsRef = collection(db, 'collections', selectedMainCollectionId, 'subcollections');
      const existingSubcollectionsSnap = await getDocs(subcollectionsRef);
      const nextShowNumber = existingSubcollectionsSnap.docs.reduce((max, item) => {
        const n = Number(item.data()?.showNumber) || 0;
        return Math.max(max, n);
      }, 0) + 1;

      // One retail price input for now. Reuse it for configured pricing keys
      // so existing role-based checkout/billing flows continue to receive a price.
      const retailPrice = Number(quickProductRetailPrice);
      const tieredPricing = PRICING_KEYS.reduce((acc, pricingKey) => {
        acc[pricingKey] = [{ min_quantity: 1, max_quantity: 999999, price: retailPrice }];
        return acc;
      }, {});

      const quantity = Number(quickProductQuantity) || 0;
      const subcollectionDoc = await addDoc(subcollectionsRef, {
        name: quickProductName.trim(),
        description: quickProductCode.trim(),
        image: uploadedImageUrl,
        showNumber: nextShowNumber,
        purchaseRate: Number(quickProductPurchaseRate),
        purchasePrice: Number(quickProductPurchaseRate),
        price: retailPrice,
        salePrice: retailPrice,
        retailPrice,
        gstRate: Math.max(0, Number(quickProductGstRate) || 0),
        gstType: quickProductGstType,
        current_stock: quantity,
        quantity,
        initialQuantity: quantity,
        minStockLevel: 0,
        trackInventory: true,
        tieredPricing,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        autoCreatedForProduct: true,
      });

      const productData = {
        productName: quickProductName.trim(),
        productCode: quickProductCode.trim(),
        image: uploadedImageUrl,
        additionalImages: [],
        quantity,
        initialQuantity: quantity,
        variations: [],
        mainCollection: selectedMainCollectionId,
        subcollectionId: subcollectionDoc.id,
        price: retailPrice,
        salePrice: retailPrice,
        retailPrice,
        purchaseRate: Number(quickProductPurchaseRate),
        purchasePrice: Number(quickProductPurchaseRate),
        gstRate: Math.max(0, Number(quickProductGstRate) || 0),
        gstType: quickProductGstType,
        tieredPricing,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const productRef = await addDoc(
        collection(db, 'collections', selectedMainCollectionId, 'subcollections', subcollectionDoc.id, productDestination),
        productData
      );
      await updateDoc(doc(db, 'collections', selectedMainCollectionId, 'subcollections', subcollectionDoc.id), {
        productId: productRef.id,
        productDestination,
        updatedAt: serverTimestamp(),
      });

      await autoEnableForDropshippers(productRef.id, productData, subcollectionDoc.id);
      await fetchSubcollections();
      setSelectedSubcollectionId(subcollectionDoc.id);
      setProducts([{ ...productData, id: productRef.id, destination: productDestination }]);
      setSelectedSubcollectionData({ id: subcollectionDoc.id, name: quickProductName.trim(), description: quickProductCode.trim(), image: uploadedImageUrl, purchaseRate: Number(quickProductPurchaseRate), tieredPricing, autoCreatedForProduct: true });

      alert('Product added successfully. Its subcollection and pricing were created automatically.');
      setQuickProductName('');
      setQuickProductCode('');
      setQuickProductQuantity('');
      setQuickProductPurchaseRate('');
      setQuickProductRetailPrice('');
      setQuickProductGstRate('0');
      setQuickProductGstType('exclusive');
      setQuickProductImage(null);
      setQuickProductImagePreview('');
      setProductEntryMode('quick');
    } catch (error) {
      console.error('Error adding quick product:', error);
      alert('Could not add the product. Please check the console for details.');
    } finally {
      setIsProductUploading(false);
    }
  };


  const handleProductImportFileChange = async (event) => {
    const file = event.target.files?.[0] || null;
    setProductImportFile(file);
    setProductImportRows([]);
    setProductImportError('');
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setProductImportError('Please upload a CSV file. Export your spreadsheet as CSV first.');
      return;
    }
    try {
      const parsed = parseProductImportCsv(await file.text());
      if (!parsed.length) {
        setProductImportError('The CSV is empty or does not contain a header row and product rows.');
        return;
      }
      const requiredHeaders = ['name', 'sale_price', 'purchase_price', 'gst_rate', 'gst_type', 'current_stock'];
      const missing = requiredHeaders.filter(header => !(header in parsed[0]));
      if (missing.length) {
        setProductImportError(`Missing required CSV columns: ${missing.join(', ')}`);
        return;
      }
      const invalidRows = parsed.filter((row, index) => !row.name || !Number.isFinite(Number(row.sale_price)) || !Number.isFinite(Number(row.purchase_price)) || !Number.isFinite(Number(row.gst_rate)) || !Number.isFinite(Number(row.current_stock)));
      if (invalidRows.length) {
        setProductImportError(`${invalidRows.length} row(s) have a missing product name or invalid sale price, purchase price, GST rate, or stock quantity. Fix these rows and upload again.`);
        return;
      }
      setProductImportRows(parsed);
    } catch (error) {
      console.error('Could not read product import CSV:', error);
      setProductImportError('Could not read this CSV file. Please export it as UTF-8 CSV and try again.');
    }
  };

  const handleImportProductsCsv = async (event) => {
    event.preventDefault();
    if (!selectedMainCollectionId) {
      alert('Please select a main collection first.');
      return;
    }
    if (!productDestination) {
      alert('Please choose Website or Mobile App.');
      return;
    }
    if (!productImportRows.length) {
      alert('Please select a valid CSV file with product rows.');
      return;
    }

    setIsProductImporting(true);
    try {
      const subcollectionsRef = collection(db, 'collections', selectedMainCollectionId, 'subcollections');
      const subcollectionsSnapshot = await getDocs(subcollectionsRef);
      const existingSubcollections = subcollectionsSnapshot.docs;

      // Check existing product codes across all subcollections in the chosen destination.
      const existingProductSnapshots = await Promise.all(existingSubcollections.map(async (subDoc) => {
        const snap = await getDocs(collection(
          db, 'collections', selectedMainCollectionId, 'subcollections', subDoc.id, productDestination
        ));
        return snap.docs;
      }));
      const existingCodes = new Set();
      existingProductSnapshots.flat().forEach((productDoc) => {
        const code = String(productDoc.data()?.productCode || '').trim().toLowerCase();
        if (code) existingCodes.add(code);
      });
      existingSubcollections.forEach((subDoc) => {
        const data = subDoc.data() || {};
        const code = String(data.productCode || data.description || '').trim().toLowerCase();
        if (data.autoCreatedForProduct && code) existingCodes.add(code);
      });

      const importedCodes = new Set();
      const rowsToImport = [];
      let skippedDuplicates = 0;

      for (const row of productImportRows) {
        const sourceName = String(row.name || '').trim();
        const separatorIndex = sourceName.indexOf('_');
        const code = (separatorIndex >= 0 ? sourceName.slice(0, separatorIndex) : sourceName).trim();
        const key = code.toLowerCase();
        if (!key || existingCodes.has(key) || importedCodes.has(key)) {
          skippedDuplicates += 1;
          continue;
        }
        importedCodes.add(key);
        rowsToImport.push({ ...row, __productCode: code, __sourceName: sourceName });
      }

      if (!rowsToImport.length) {
        alert(`No new products imported. All ${skippedDuplicates} row(s) matched existing product codes or duplicates in this CSV.`);
        return;
      }

      const startingShowNumber = existingSubcollections.reduce((max, item) => {
        return Math.max(max, Number(item.data()?.showNumber) || 0);
      }, 0);
      const createdSubcollectionIds = [];
      const now = serverTimestamp();

      // Two Firestore writes per product. Chunks of 200 products stay below the 500-write batch limit.
      for (let offset = 0; offset < rowsToImport.length; offset += 200) {
        const chunk = rowsToImport.slice(offset, offset + 200);
        const batch = writeBatch(db);

        chunk.forEach((row, chunkIndex) => {
          const sourceName = String(row.__sourceName || row.name || '').trim();
          const separatorIndex = sourceName.indexOf('_');
          const productCodeValue = String(row.__productCode || (separatorIndex >= 0 ? sourceName.slice(0, separatorIndex) : sourceName)).trim();
          const productNameSource = separatorIndex >= 0 ? sourceName.slice(separatorIndex + 1) : sourceName;
          const productNameValue = productNameSource
            .replace(/[_-]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/\b\w/g, letter => letter.toUpperCase());

          const salePrice = Number(row.sale_price);
          const purchasePrice = Number(row.purchase_price);
          const quantity = Math.max(0, Number(row.current_stock) || 0);
          const gstRate = Math.max(0, Number(row.gst_rate) || 0);
          const minStockLevel = Math.max(0, Number(row.min_stock_level) || 0);
          const gstType = String(row.gst_type || 'exclusive').trim().toLowerCase();
          const trackInventoryValue = String(row.track_inventory || 'yes').trim().toLowerCase();
          const status = String(row.status || 'active').trim().toLowerCase();
          const trackInventory = ['yes', 'true', '1'].includes(trackInventoryValue);
          const tieredPricing = PRICING_KEYS.reduce((acc, pricingKey) => {
            acc[pricingKey] = [{ min_quantity: 1, max_quantity: 999999, price: salePrice }];
            return acc;
          }, {});
          const importedFields = {
            name: productCodeValue,
            type: row.type || 'product',
            unit: row.unit || '',
            sale_price: salePrice,
            purchase_price: purchasePrice,
            gst_rate: gstRate,
            gst_type: gstType,
            current_stock: quantity,
            min_stock_level: minStockLevel,
            track_inventory: trackInventoryValue,
            status,
          };

          const subcollectionDocRef = doc(subcollectionsRef);
          const productCollectionRef = collection(
            db, 'collections', selectedMainCollectionId, 'subcollections', subcollectionDocRef.id, productDestination
          );
          const productDocRef = doc(productCollectionRef);
          createdSubcollectionIds.push(subcollectionDocRef.id);

          const commercialData = {
            type: importedFields.type,
            unit: importedFields.unit,
            price: salePrice,
            salePrice,
            retailPrice: salePrice,
            purchaseRate: purchasePrice,
            purchasePrice,
            gstRate,
            gstType,
            current_stock: quantity,
            quantity,
            initialQuantity: quantity,
            minStockLevel,
            trackInventory,
            status,
            tieredPricing,
            importedFields,
            importSource: 'itemsimprt.csv',
            createdAt: now,
            updatedAt: now,
          };

          // Each product gets its own automatically created subcollection with the same pricing/tax/stock data.
          batch.set(subcollectionDocRef, {
            name: productNameValue,
            description: productCodeValue,
            image: '',
            showNumber: startingShowNumber + offset + chunkIndex + 1,
            productCode: productCodeValue,
            productId: productDocRef.id,
            ...commercialData,
            autoCreatedForProduct: true,
          });

          batch.set(productDocRef, {
            productName: productNameValue,
            productCode: productCodeValue,
            image: '',
            additionalImages: [],
            variations: [],
            mainCollection: selectedMainCollectionId,
            subcollectionId: subcollectionDocRef.id,
            ...commercialData,
          });
        });

        await batch.commit();
      }

      await fetchSubcollections();
      setSelectedSubcollectionId(createdSubcollectionIds[createdSubcollectionIds.length - 1] || '');
      setProductEntryMode('manage');
      alert(`Imported ${rowsToImport.length} product(s). Each product now has its own automatically created subcollection and product document. ${skippedDuplicates} duplicate row(s) skipped. Retail price, purchase price, GST and stock are saved in both places.`);
      setProductImportFile(null);
      setProductImportRows([]);
      setProductImportError('');
      const fileInput = document.getElementById('product-csv-import-input');
      if (fileInput) fileInput.value = '';
    } catch (error) {
      console.error('Product CSV import failed:', error);
      alert(`Product import failed: ${error.message || 'Please check the console and try again.'}`);
    } finally {
      setIsProductImporting(false);
    }
  };

  const handleDeoDapFolderUpload = async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    setDeodapFolderLoading(true);
    try {
      const jsonFiles = files.filter(file => /(^|\/)product\.json$/i.test(file.webkitRelativePath || file.name) || /\.json$/i.test(file.name));
      const parsedProducts = [];
      const errors = [];
      for (const file of jsonFiles) {
        try {
          const parsed = JSON.parse(await file.text());
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
          const title = String(parsed.title ?? parsed.matched_title ?? parsed.productName ?? parsed.inventory_name ?? '').trim();
          if (!title) continue;
          parsedProducts.push({
            ...parsed,
            __catalogKey: `${file.webkitRelativePath || file.name}:${parsed.inventory_code || parsed.handle || title}`,
            __fileName: file.webkitRelativePath || file.name,
            __title: title,
            __sku: String(parsed.sku ?? parsed.inventoryRow?.sku ?? parsed.variants?.[0]?.sku ?? parsed.variant_details?.[0]?.sku ?? '').trim(),
            // Prefer the top-level scraped selling price, then fall back to the first variant.
            // This prevents an empty top-level field from leaving old product pricing unchanged.
            __price: parsed.price ?? parsed.salePrice ?? parsed.sellingPrice ?? parsed.retailPrice
              ?? parsed.variants?.[0]?.price ?? parsed.variant_details?.[0]?.price ?? '',
            __compareAt: parsed.compareAtPrice ?? parsed.compare_at_price ?? parsed.compare_at_price_max
              ?? parsed.variants?.[0]?.compareAtPrice ?? parsed.variants?.[0]?.compare_at_price
              ?? parsed.variant_details?.[0]?.compareAtPrice ?? parsed.variant_details?.[0]?.compare_at_price ?? '',
            __discount: parsed.discountPercentage ?? parsed.discount_percentage
              ?? parsed.variants?.[0]?.discountPercentage ?? parsed.variant_details?.[0]?.discountPercentage ?? '',
            __tags: Array.isArray(parsed.tags) ? parsed.tags : String(parsed.tags || '').split(',').map(v => v.trim()).filter(Boolean),
            __descriptionHtml: parsed.descriptionHtml ?? parsed.description_html ?? '',
            __descriptionText: parsed.descriptionText ?? parsed.description_text ?? '',
            __keyFeatures: parsed.keyFeatures ?? parsed.key_features ?? [],
            __faqs: parsed.faqs ?? parsed.faq ?? [],
            __variants: parsed.variants ?? parsed.variant_details ?? [],
          });
        } catch (error) {
          errors.push(file.webkitRelativePath || file.name);
        }
      }
      const unique = Array.from(new Map(parsedProducts.map(item => [item.__catalogKey, item])).values());
      setDeodapScrapedCatalog(unique);
      setDeodapFolderName(files[0]?.webkitRelativePath?.split('/')[0] || 'Selected folder');
      setDeodapSelectedMatch({});
      setDeodapMatchSearch({});
      setDeodapConnectionStatus({});
      setDeodapConnectionReport(null);
      const autoMatched = allCollectionProducts.filter(product => { const code = normalizeProductCode(product.productCode); return code && unique.filter(item => normalizeProductCode(getDeoDapRecordCode(item)) === code).length === 1; }).length;
      alert(`Loaded ${unique.length} scraped product record(s). Automatically identified ${autoMatched} unique product-code match(es). Review each match and click Connect & update to apply it.${errors.length ? ` ${errors.length} JSON file(s) could not be read.` : ''}`);
    } catch (error) {
      console.error('DeoDap folder import failed:', error);
      alert('Could not read the selected output folder. Please select the scraper output folder again.');
    } finally {
      setDeodapFolderLoading(false);
      event.target.value = '';
    }
  };

  const handleDeodapBulkImagesUpload = async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    const imageFiles = files.filter(file => /^image\/(jpeg|png|webp|avif)$/i.test(file.type) || /\.(jpe?g|png|webp|avif)$/i.test(file.name));
    const jsonFiles = files.filter(file => /(^|\/)product\.json$/i.test(file.webkitRelativePath || file.name));
    if (!imageFiles.length) {
      alert('No product images were found. Choose the scraper output folder containing products/<SKU>/images/.');
      event.target.value = '';
      return;
    }
    if (!allCollectionProducts.length || !selectedMainCollectionId) {
      alert('First select the collection and load its existing products, then choose the scraper output folder.');
      event.target.value = '';
      return;
    }
    if (!window.confirm(`Process ${imageFiles.length} image file(s) from the selected folder?\n\nImages will be compressed to WebP (maximum 1000px, quality 72%), uploaded to Firebase Storage, and the matching existing product records will be updated. Existing product image fields will be replaced for matched products. Continue?`)) {
      event.target.value = '';
      return;
    }

    setDeodapImageUploading(true);
    setDeodapImageFolderName(files[0]?.webkitRelativePath?.split('/')[0] || 'Selected folder');
    const originalBytes = imageFiles.reduce((total, file) => total + (Number(file.size) || 0), 0);
    setDeodapImageSizeReport({ originalBytes, compressedBytes: 0, imageCount: imageFiles.length, compressedCount: 0 });
    const progress = { current: 0, total: imageFiles.length, uploaded: 0, matched: 0, failed: 0, skipped: 0, currentSku: '' };
    setDeodapImageProgress(progress);

    try {
      const pathPartsFor = (file) => (file.webkitRelativePath || file.name).split('/').filter(Boolean);
      const productFolderFor = (file) => {
        const parts = pathPartsFor(file);
        const productsIndex = parts.findIndex(part => part.toLowerCase() === 'products');
        if (productsIndex >= 0 && parts[productsIndex + 1]) return parts[productsIndex + 1];
        const imagesIndex = parts.findIndex(part => part.toLowerCase() === 'images');
        if (imagesIndex > 0) return parts[imagesIndex - 1];
        return parts.length > 1 ? parts[parts.length - 2] : '';
      };

      const productGroups = new Map();
      imageFiles.forEach(file => {
        const folder = productFolderFor(file);
        if (!folder) return;
        if (!productGroups.has(folder)) productGroups.set(folder, []);
        productGroups.get(folder).push(file);
      });
      const metadataByFolder = new Map();
      for (const file of jsonFiles) {
        const parts = pathPartsFor(file);
        const folder = productFolderFor(file);
        if (folder && /(^|\/)product\.json$/i.test(file.webkitRelativePath || file.name)) {
          try { metadataByFolder.set(folder, JSON.parse(await file.text())); } catch (error) {
            console.warn('Could not parse product metadata:', file.webkitRelativePath || file.name, error);
          }
        }
      }

      const getProductSkuCandidates = (product) => [
        product?.sku,
        product?.inventoryRow?.sku,
        product?.inventory_name,
        product?.inventoryName,
      ].map(value => String(value ?? '').trim()).filter(Boolean);
      const matchedProductIds = new Set();
      const failures = [];
      let imageIndex = 0;

      for (const [folder, groupFiles] of productGroups.entries()) {
        const metadata = metadataByFolder.get(folder) || {};
        const skuCandidates = [
          metadata.sku,
          metadata.inventoryRow?.sku,
          ...(Array.isArray(metadata.variants) ? metadata.variants.map(item => item?.sku) : []),
          ...(Array.isArray(metadata.variant_details) ? metadata.variant_details.map(item => item?.sku) : []),
          folder,
        ].map(value => String(value ?? '').trim()).filter(Boolean);
        const normalizedCandidates = new Set(skuCandidates.map(normalizeProductCode));
        const codeCandidates = new Set(skuCandidates.map(getDeoDapCodeFromSku).filter(Boolean).map(normalizeProductCode));

        let matches = allCollectionProducts.filter(product => {
          const exactValues = getProductSkuCandidates(product).concat([product?.productCode])
            .map(normalizeProductCode).filter(Boolean);
          if (exactValues.some(value => normalizedCandidates.has(value))) return true;
          const productCodeValue = normalizeProductCode(product?.productCode || getDeoDapCodeFromSku(product?.sku));
          return productCodeValue && codeCandidates.has(productCodeValue);
        });

        if (matches.length !== 1) {
          progress.skipped += groupFiles.length;
          progress.current = Math.min(imageIndex + groupFiles.length, progress.total);
          setDeodapImageProgress({ ...progress, currentSku: folder });
          imageIndex += groupFiles.length;
          if (matches.length > 1) failures.push(`${folder}: ambiguous match (${matches.length} products)`);
          else failures.push(`${folder}: no matching product SKU/code`);
          continue;
        }

        const product = matches[0];
        const matchId = `${product.destination || 'products'}:${product.id}`;
        if (matchedProductIds.has(matchId)) {
          progress.skipped += groupFiles.length;
          failures.push(`${folder}: another folder already matched this product`);
          imageIndex += groupFiles.length;
          continue;
        }

        const subId = product.subcollectionId || selectedSubcollectionId;
        if (!selectedMainCollectionId || !subId || !product.id) {
          progress.skipped += groupFiles.length;
          failures.push(`${folder}: product has no valid collection path`);
          imageIndex += groupFiles.length;
          continue;
        }

        const sortedFiles = [...groupFiles].sort((a, b) => {
          const numA = Number((a.name.match(/image[_-]?(\d+)/i) || [])[1] || 9999);
          const numB = Number((b.name.match(/image[_-]?(\d+)/i) || [])[1] || 9999);
          return numA - numB || a.name.localeCompare(b.name);
        });
        const uploadedUrls = [];
        const storageSku = safeStorageSegment(skuCandidates[0] || folder);
        for (const file of sortedFiles) {
          progress.currentSku = skuCandidates[0] || folder;
          setDeodapImageProgress({ ...progress, current: imageIndex, currentSku: progress.currentSku });
          try {
            const compressedBlob = await compressProductImage(file);
            setDeodapImageSizeReport(previous => ({ ...previous, compressedBytes: previous.compressedBytes + compressedBlob.size, compressedCount: previous.compressedCount + 1 }));
            const baseName = safeStorageSegment(file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '-')) || `image-${uploadedUrls.length + 1}`;
            const imageRef = ref(storage, `deodap-product-images/${storageSku}/${baseName}.webp`);
            const snapshot = await uploadBytes(imageRef, compressedBlob, { contentType: 'image/webp', cacheControl: 'public,max-age=31536000,immutable' });
            uploadedUrls.push(await getDownloadURL(snapshot.ref));
            progress.uploaded += 1;
          } catch (error) {
            console.error(`Image upload failed for ${folder}/${file.name}`, error);
            progress.failed += 1;
            failures.push(`${folder}/${file.name}: ${error.message || 'upload failed'}`);
          } finally {
            imageIndex += 1;
            progress.current = imageIndex;
            setDeodapImageProgress({ ...progress });
          }
        }

        if (uploadedUrls.length) {
          try {
            const productRef = doc(db, 'collections', selectedMainCollectionId, 'subcollections', subId, product.destination || 'products', product.id);
            await updateDoc(productRef, {
              image: uploadedUrls[0],
              imageUrl: uploadedUrls[0],
              imageUrls: uploadedUrls,
              updatedAt: serverTimestamp(),
            });
            matchedProductIds.add(matchId);
            progress.matched += 1;
          } catch (error) {
            progress.failed += 1;
            failures.push(`${folder}: uploaded, but Firestore save failed: ${error.message || 'unknown error'}`);
          }
        }
        setDeodapImageProgress({ ...progress, current: imageIndex, currentSku: progress.currentSku });
      }

      const summary = `Bulk image import finished.\n\nProducts updated: ${progress.matched}\nImages uploaded: ${progress.uploaded}\nImage upload/save failures: ${progress.failed}\nImages skipped: ${progress.skipped}`;
      alert(`${summary}${failures.length ? `\n\nFirst issues:\n${failures.slice(0, 12).join('\n')}${failures.length > 12 ? `\n...and ${failures.length - 12} more` : ''}` : ''}`);
      await fetchAllCollectionProducts(selectedMainCollectionId);
    } catch (error) {
      console.error('Bulk DeoDap image upload failed:', error);
      alert(`Bulk image upload failed: ${error.message || 'Please check the console.'}`);
    } finally {
      setDeodapImageUploading(false);
      event.target.value = '';
    }
  };

  const handleConnectDeoDapRecord = async (product, scraped, options = {}) => {
    if (!product || !scraped) return false;
    const mainId = selectedMainCollectionId;
    const subId = product.subcollectionId || selectedSubcollectionId;
    if (!mainId || !subId || !product.id) {
      if (!options.silent) alert('Please select a collection and a valid existing product row first.');
      return false;
    }
    const recordId = `${product.destination || 'products'}:${product.id}`;
    if (!options.skipConfirm && !window.confirm(`Connect scraper data to existing product "${product.productName || product.productCode || product.id}"?\n\nProduct code and image fields will not be changed. Selling price and all tiered pricing roles will be updated.`)) return false;
    setDeodapConnectingId(recordId);
    setDeodapConnectionStatus(prev => ({ ...prev, [recordId]: { state: 'connecting', title: scraped.__title || product.productName || product.productCode || product.id } }));
    try {
      // Normalize price values from either the parsed product record or its first variant.
      const rawSourcePrice = scraped.__price ?? scraped.price ?? scraped.salePrice ?? scraped.sellingPrice
        ?? scraped.retailPrice ?? scraped.variants?.[0]?.price ?? scraped.variant_details?.[0]?.price;
      const sourcePrice = rawSourcePrice === '' || rawSourcePrice === null || rawSourcePrice === undefined
        ? NaN
        : Number(String(rawSourcePrice).replace(/[₹,\\s]/g, ''));
      const rawCompareAt = scraped.__compareAt ?? scraped.compareAtPrice ?? scraped.compare_at_price
        ?? scraped.variants?.[0]?.compareAtPrice ?? scraped.variants?.[0]?.compare_at_price;
      const compareAt = rawCompareAt === '' || rawCompareAt === null || rawCompareAt === undefined
        ? 0
        : (Number(String(rawCompareAt).replace(/[₹,\\s]/g, '')) || 0);
      const validPrice = Number.isFinite(sourcePrice) && sourcePrice >= 0;
      const discount = scraped.__discount !== '' && scraped.__discount != null
        ? Number(scraped.__discount) || 0
        : (compareAt > 0 && validPrice ? Math.max(0, ((compareAt - sourcePrice) / compareAt) * 100) : 0);
      const keyFeatures = Array.isArray(scraped.__keyFeatures) ? scraped.__keyFeatures : String(scraped.__keyFeatures || '').split(/\r?\n/).map(v => v.trim()).filter(Boolean);
      const faqs = Array.isArray(scraped.__faqs) ? scraped.__faqs : [];
      const tags = Array.isArray(scraped.__tags) ? scraped.__tags : [];
      const subRef = doc(db, 'collections', mainId, 'subcollections', subId);
      const productRef = doc(db, 'collections', mainId, 'subcollections', subId, product.destination || 'products', product.id);
      const subSnap = await getDoc(subRef);
      const subData = subSnap.exists() ? subSnap.data() : {};
      const oldPricing = subData.tieredPricing || product.tieredPricing || {};
      // Preserve any additional pricing roles, then update every configured role and every tier.
      const tieredPricing = { ...oldPricing };
      PRICING_KEYS.forEach((key) => {
        const existing = Array.isArray(oldPricing[key]) ? oldPricing[key] : [];
        tieredPricing[key] = existing.length
          ? existing.map((tier) => ({ ...tier, price: validPrice ? sourcePrice : (Number(tier.price) || 0) }))
          : [{ min_quantity: 1, max_quantity: 999999, price: validPrice ? sourcePrice : 0 }];
      });
      const scrapedData = {
        productName: scraped.__title,
        // Write every common selling-price alias so old fields cannot override the imported price in UI/cart code.
        ...(validPrice ? {
          sellingPrice: sourcePrice,
          retailPrice: sourcePrice,
          salePrice: sourcePrice,
          price: sourcePrice,
        } : {}),
        compareAtPrice: compareAt,
        discountPercentage: discount,
        ...(scraped.__sku ? { sku: scraped.__sku } : {}),
        tags,
        vendor: String(scraped.vendor || ''),
        productType: String(scraped.productType ?? scraped.product_type ?? ''),
        descriptionHtml: String(scraped.__descriptionHtml || ''),
        descriptionText: String(scraped.__descriptionText || ''),
        keyFeatures,
        faqs,
        source: String(scraped.source || 'deodap.in'),
        productUrl: String(scraped.productUrl ?? scraped.product_url ?? ''),
        handle: String(scraped.handle || ''),
        available: scraped.available !== false,
        currency: String(scraped.currency || 'INR'),
        origin: String(scraped.origin || ''),
        scrapedAt: String(scraped.scrapedAt ?? scraped.scraped_at ?? ''),
        scrapedVariants: Array.isArray(scraped.__variants) ? scraped.__variants : [],
        // Intentionally omit productCode and all image/image-URL fields from this import.
        tieredPricing,
        updatedAt: serverTimestamp(),
      };
      const batch = writeBatch(db);
      batch.update(productRef, scrapedData);
      batch.set(subRef, {
        tieredPricing,
        // Keep the parent subcollection's direct price aliases in sync with its tiered pricing.
        ...(validPrice ? {
          sellingPrice: sourcePrice,
          retailPrice: sourcePrice,
          salePrice: sourcePrice,
          price: sourcePrice,
        } : {}),
        deodapProductDetails: {
          [product.id]: {
            productId: product.id,
            productName: scraped.__title,
            productCode: product.productCode || '',
            ...scrapedData,
            sourceProductTitle: scraped.__title,
            sourceFile: scraped.__fileName,
            updatedAt: serverTimestamp(),
          },
        },
        updatedAt: serverTimestamp(),
      }, { merge: true });
      await batch.commit();
      setDeodapSelectedMatch(prev => ({ ...prev, [recordId]: '' }));
      setDeodapConnectionStatus(prev => ({ ...prev, [recordId]: { state: 'connected', title: scraped.__title || product.productName || product.productCode || product.id, productCode: product.productCode || '', sku: scraped.__sku || '' } }));
      if (!options.skipRefresh) {
        await fetchProducts();
        await fetchAllCollectionProducts(mainId);
      }
      if (!options.silent) alert(`Connected "${scraped.__title}" to the existing product. Product code and image fields were preserved; selling price and all tiered pricing roles were updated.`);
      return true;
    } catch (error) {
      console.error('Failed to connect DeoDap product:', error);
      setDeodapConnectionStatus(prev => ({ ...prev, [recordId]: { state: 'failed', title: scraped.__title || product.productName || product.productCode || product.id, productCode: product.productCode || '', sku: scraped.__sku || '', error: error.message || 'Unknown Firestore error' } }));
      if (!options.silent) alert(`Could not connect this product: ${error.message || 'Unknown Firestore error'}`);
      return false;
    } finally {
      setDeodapConnectingId(null);
    }
  };

  const handleConnectAllDeoDapMatches = async () => {
    if (deodapBulkConnecting || !deodapScrapedCatalog.length) return;
    const candidates = [];
    const unmatched = [];
    const ambiguous = [];
    const usedCatalogKeys = new Set();

    for (const product of allCollectionProducts) {
      const rowKey = `${product.destination || 'products'}:${product.id}`;
      const chosenKey = deodapSelectedMatch[rowKey] || '';
      const chosen = deodapScrapedCatalog.find(item => item.__catalogKey === chosenKey);
      const code = normalizeProductCode(product.productCode);
      const codeMatches = code ? deodapScrapedCatalog.filter(item => normalizeProductCode(getDeoDapRecordCode(item)) === code) : [];
      const record = chosen || (codeMatches.length === 1 ? codeMatches[0] : null);

      if (!record) {
        if (codeMatches.length > 1) ambiguous.push({ product, count: codeMatches.length });
        else unmatched.push(product);
        continue;
      }
      if (usedCatalogKeys.has(record.__catalogKey)) {
        ambiguous.push({ product, count: 0, reason: 'This scraper record is already assigned to another product.' });
        continue;
      }
      usedCatalogKeys.add(record.__catalogKey);
      candidates.push({ product, record });
    }

    if (!candidates.length) {
      setDeodapConnectionReport({ connected: [], failed: [], unmatched, ambiguous, message: 'No unique matches were ready to connect. Manually select a scraper record in the product row for unmatched products.' });
      return;
    }

    if (!window.confirm(`Connect and update ${candidates.length} matched product(s) now?\n\n${unmatched.length} unmatched and ${ambiguous.length} ambiguous products will be skipped.\nProduct codes and image fields will be preserved.`)) return;

    setDeodapBulkConnecting(true);
    const connected = [];
    const failed = [];
    for (const { product, record } of candidates) {
      const key = `${product.destination || 'products'}:${product.id}`;
      const ok = await handleConnectDeoDapRecord(product, record, { skipConfirm: true, skipRefresh: true, silent: true });
      const details = { key, title: record.__title || product.productName || product.productCode || product.id, productCode: product.productCode || '', sku: record.__sku || '' };
      if (ok) connected.push(details);
      else {
        const state = (deodapConnectionStatus[key] || {});
        failed.push({ ...details, error: state.error || 'Firestore write failed; check the browser console for details.' });
      }
    }

    try {
      await fetchProducts();
      await fetchAllCollectionProducts(selectedMainCollectionId);
    } catch (refreshError) {
      console.error('Could not refresh product list after bulk DeoDap sync:', refreshError);
    }
    setDeodapConnectionReport({ connected, failed, unmatched, ambiguous });
    setDeodapBulkConnecting(false);
  };

  const loadDeoDapScrapedJson = () => {
    try {
      const parsed = JSON.parse(deodapRawJson);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Paste one product JSON object.');
      }
      setDeodapRawData(parsed);
      setProductName(String(parsed.title ?? parsed.productName ?? productName));
      // Keep the existing inventory product code unchanged; scraped SKU is stored separately.
      if (parsed.price !== undefined) setEditProductRetailPrice(String(parsed.price));
      setDeodapFields({
        sku: String(parsed.sku ?? parsed.inventoryRow?.sku ?? parsed.productCode ?? ''),
        tags: Array.isArray(parsed.tags) ? parsed.tags.join(', ') : String(parsed.tags || ''),
        compareAtPrice: String(parsed.compareAtPrice ?? ''),
        discountPercentage: String(parsed.discountPercentage ?? ''),
        vendor: String(parsed.vendor ?? ''),
        productType: String(parsed.productType ?? ''),
        descriptionHtml: String(parsed.descriptionHtml ?? ''),
        descriptionText: String(parsed.descriptionText ?? ''),
        keyFeatures: Array.isArray(parsed.keyFeatures) ? parsed.keyFeatures.join('\\n') : String(parsed.keyFeatures || ''),
        faqs: JSON.stringify(Array.isArray(parsed.faqs) ? parsed.faqs : [], null, 2),
        source: String(parsed.source ?? 'deodap.in'),
        productUrl: String(parsed.productUrl ?? ''),
        handle: String(parsed.handle ?? ''),
        available: parsed.available !== false,
        origin: String(parsed.origin ?? ''),
        currency: String(parsed.currency ?? 'INR'),
        scrapedAt: String(parsed.scrapedAt ?? ''),
        sourceImageUrls: '',
      });
      alert('Scraped JSON loaded. Review the fields, then click Update Product to save.');
    } catch (error) {
      alert(error.message === 'Paste one product JSON object.' ? error.message : 'Invalid JSON. Paste one complete product JSON object from the scraper.');
    }
  };

  const startEditProduct = (product) => {
    const owningSubcollectionId = product.subcollectionId || selectedSubcollectionId;
    const owningSubcollectionData = product.subcollectionData || selectedSubcollectionData;
    if (owningSubcollectionId) setSelectedSubcollectionId(owningSubcollectionId);
    if (owningSubcollectionData) setSelectedSubcollectionData(owningSubcollectionData);
    setEditingProduct({ ...product, subcollectionId: owningSubcollectionId, subcollectionData: owningSubcollectionData });
    setDeodapRawData(product.deodapRawData && typeof product.deodapRawData === 'object' ? product.deodapRawData : {});
    setDeodapRawJson('');
    setProductName(product.productName || "");
    setProductCode(product.productCode || "");

    if (product.variations && product.variations.length > 0) {
      setProductVariations(product.variations.map(v => ({
        color: v.color || "",
        size: v.size || "",
        quantity: v.quantity ?? "",
        initialQuantity: v.initialQuantity ?? v.quantity ?? "",
      })));
      setProductQuantity("");
    } else {
      setProductVariations([]);
      setProductQuantity(product.quantity ?? "");
    }

    setNewVariation({ color: "", size: "", quantity: "" });
    setAdditionalImages((product.additionalImages || []).map(url => ({ previewUrl: url })));

    // Prices belong to the subcollection in the existing Firestore schema.
    // Only auto-created one-product subcollections are edited from this product form.
    const savedPricing = owningSubcollectionData?.tieredPricing || {};
    const nextPrices = PRICING_KEYS.reduce((acc, key) => {
      const tiers = Array.isArray(savedPricing[key]) ? savedPricing[key] : [];
      acc[key] = tiers.length ? String(tiers[0].price ?? '') : '';
      return acc;
    }, {});
    setEditProductPrices(nextPrices);
    setEditProductPurchaseRate(
      (product.purchasePrice ?? product.purchaseRate ?? owningSubcollectionData?.purchasePrice ?? owningSubcollectionData?.purchaseRate) !== undefined
        ? String(product.purchasePrice ?? product.purchaseRate ?? owningSubcollectionData?.purchasePrice ?? owningSubcollectionData?.purchaseRate)
        : ''
    );
    setEditProductRetailPrice(String(product.retailPrice ?? product.salePrice ?? product.price ?? owningSubcollectionData?.retailPrice ?? owningSubcollectionData?.salePrice ?? ''));
    setEditProductGstRate(String(product.gstRate ?? product.gst_rate ?? owningSubcollectionData?.gstRate ?? 0));
    setEditProductGstType(product.gstType ?? product.gst_type ?? owningSubcollectionData?.gstType ?? 'exclusive');
    setDeodapFields({
      sku: String(product.sku ?? product.inventoryRow?.sku ?? product.productCode ?? ''),
      tags: Array.isArray(product.tags) ? product.tags.join(', ') : String(product.tags || ''),
      compareAtPrice: String(product.compareAtPrice ?? ''),
      discountPercentage: String(product.discountPercentage ?? ''),
      vendor: String(product.vendor ?? ''),
      productType: String(product.productType ?? ''),
      descriptionHtml: String(product.descriptionHtml ?? ''),
      descriptionText: String(product.descriptionText ?? ''),
      keyFeatures: Array.isArray(product.keyFeatures) ? product.keyFeatures.join('\n') : String(product.keyFeatures || ''),
      faqs: JSON.stringify(Array.isArray(product.faqs) ? product.faqs : [], null, 2),
      source: String(product.source ?? 'deodap.in'),
      productUrl: String(product.productUrl ?? ''),
      handle: String(product.handle ?? ''),
      available: product.available !== false,
    });
    setShowProductForm(true);
  };

  const handleUpdateProduct = async (e) => {
    e.preventDefault();
    setIsProductUploading(true);

    try {
      const productDocRef = doc(
        db,
        "collections",
        selectedMainCollectionId,
        "subcollections",
        editingProduct.subcollectionId || selectedSubcollectionId,
        editingProduct.destination || "products",
        editingProduct.id
      );

      /* -----------------------------------------
         STEP 1: UPLOAD ONLY NEW IMAGES
      ------------------------------------------ */
      const uploadedNewImageUrls = [];

      for (const img of additionalImages) {
        // img.file exists ONLY for newly added images
        if (img.file) {
          const url = await uploadImageAndGetURL(img.file);
          uploadedNewImageUrls.push(url);
        }
      }

      /* -----------------------------------------
         STEP 2: KEEP EXISTING IMAGE URLS
      ------------------------------------------ */
      const existingImageUrls = additionalImages
        .filter(img => !img.file && img.previewUrl)
        .map(img => img.previewUrl);

      const allImageUrls = [
        ...(editingProduct.image ? [editingProduct.image] : []),
        ...existingImageUrls,
        ...uploadedNewImageUrls,
      ];

      const mainImageUrl = allImageUrls[0] || "";
      const additionalImageUrls = allImageUrls.slice(1);

      /* -----------------------------------------
         STEP 3: HANDLE VARIATIONS / QUANTITY
      ------------------------------------------ */
      let finalVariations = [];
      let finalQuantity = 0;

      if (productVariations.length > 0) {
   finalVariations = productVariations.map(v => ({
  color: v.color || "",
  size: v.size || "",
  quantity: Number(v.quantity) || 0,
  initialQuantity: (v.initialQuantity ?? Number(v.quantity)) || 0
}));

        finalQuantity = finalVariations.reduce(
          (sum, v) => sum + v.quantity,
          0
        );
      } else {
        finalQuantity = Number(productQuantity) || 0;
        finalVariations = [];
      }

      /* -----------------------------------------
         STEP 4: UPDATE FIRESTORE (🔥 IMPORTANT)
      ------------------------------------------ */
      const productData = {
        productName,
        productCode,

        image: mainImageUrl,                      // ✅ main image
        additionalImages: additionalImageUrls,    // ✅ what ProductCard expects

        quantity: finalQuantity,
        current_stock: finalQuantity,
        initialQuantity: Number(editingProduct.initialQuantity ?? finalQuantity),
        variations: finalVariations,
        purchaseRate: Number(editProductPurchaseRate || 0),
        purchasePrice: Number(editProductPurchaseRate || 0),
        retailPrice: Number(editProductRetailPrice || 0),
        salePrice: Number(editProductRetailPrice || 0),
        price: Number(editProductRetailPrice || 0),
        gstRate: Math.max(0, Number(editProductGstRate) || 0),
        gstType: editProductGstType || 'exclusive',
        // DeoDap catalog metadata is additive; productCode and image fields remain the existing inventory values.
        sku: deodapFields.sku.trim() || productCode.trim(),
        tags: deodapFields.tags.split(',').map(tag => tag.trim()).filter(Boolean),
        compareAtPrice: Number(deodapFields.compareAtPrice) || 0,
        discountPercentage: deodapFields.discountPercentage !== ''
          ? Number(deodapFields.discountPercentage) || 0
          : (Number(deodapFields.compareAtPrice) > 0
            ? Math.max(0, ((Number(deodapFields.compareAtPrice) - Number(editProductRetailPrice || 0)) / Number(deodapFields.compareAtPrice)) * 100)
            : 0),
        vendor: deodapFields.vendor.trim(),
        productType: deodapFields.productType.trim(),
        descriptionHtml: deodapFields.descriptionHtml,
        descriptionText: deodapFields.descriptionText,
        keyFeatures: deodapFields.keyFeatures.split('\n').map(item => item.trim()).filter(Boolean),
        faqs: (() => {
          try {
            const parsed = JSON.parse(deodapFields.faqs || '[]');
            if (!Array.isArray(parsed)) throw new Error('FAQs must be a JSON array.');
            return parsed;
          } catch (error) {
            throw new Error('FAQs must be valid JSON in array format, for example: [{"question":"Question","answer":"Answer"}].');
          }
        })(),
        source: deodapFields.source.trim(),
        productUrl: deodapFields.productUrl.trim(),
        handle: deodapFields.handle.trim(),
        available: Boolean(deodapFields.available),
        updatedAt: serverTimestamp(),
      };

      // Prepare and validate subcollection updates before writing either document.
      // Legacy shared subcollections are deliberately left untouched from product edit.
      let autoSubcollectionUpdate = null;
      if ((editingProduct.subcollectionData || selectedSubcollectionData)?.autoCreatedForProduct) {
        const missingPrices = PRICING_KEYS.filter(
          key => editProductPrices[key] === '' || !Number.isFinite(Number(editProductPrices[key])) || Number(editProductPrices[key]) < 0
        );
        if (missingPrices.length) {
          throw new Error(`Please enter valid prices for: ${missingPrices.join(', ')}`);
        }
        if (editProductPurchaseRate === '' || !Number.isFinite(Number(editProductPurchaseRate)) || Number(editProductPurchaseRate) < 0) {
          throw new Error('Please enter a valid purchase rate.');
        }

        const tieredPricing = PRICING_KEYS.reduce((acc, key) => {
          const existingTiers = (editingProduct.subcollectionData || selectedSubcollectionData)?.tieredPricing?.[key];
          const firstTier = Array.isArray(existingTiers) && existingTiers.length ? existingTiers[0] : {};
          acc[key] = [{
            ...firstTier,
            min_quantity: 1,
            max_quantity: 999999,
            price: Number(editProductPrices[key]),
          }];
          return acc;
        }, {});

        const retailPrice = Number(editProductRetailPrice);
        if (editProductRetailPrice === '' || !Number.isFinite(retailPrice) || retailPrice < 0) throw new Error('Please enter a valid retail price.');
        autoSubcollectionUpdate = {
          name: productName.trim(), description: productCode.trim(),
          purchaseRate: Number(editProductPurchaseRate), purchasePrice: Number(editProductPurchaseRate),
          price: retailPrice, salePrice: retailPrice, retailPrice,
          gstRate: Math.max(0, Number(editProductGstRate) || 0), gstType: editProductGstType || 'exclusive',
          quantity: finalQuantity, current_stock: finalQuantity,
          initialQuantity: Number(editingProduct.initialQuantity ?? finalQuantity),
          tieredPricing, updatedAt: serverTimestamp(),
        };
      }

      const subcollectionRef = doc(
        db, "collections", selectedMainCollectionId, "subcollections",
        editingProduct.subcollectionId || selectedSubcollectionId
      );
      const batch = writeBatch(db);
      batch.update(productDocRef, productData);
      if (autoSubcollectionUpdate) {
        batch.update(subcollectionRef, autoSubcollectionUpdate);
      }
      // Store a product-keyed snapshot on the parent subcollection without replacing
      // existing subcollection fields or legacy shared pricing/inventory data.
      batch.set(subcollectionRef, {
        deodapProductDetails: {
          [editingProduct.id]: {
            productId: editingProduct.id,
            productName: productName.trim(),
            productCode: productCode.trim(),
            ...productData,
            updatedAt: serverTimestamp(),
          },
        },
        updatedAt: serverTimestamp(),
      }, { merge: true });
      await batch.commit();

      alert("Product updated successfully!");
      fetchProducts();
      fetchAllCollectionProducts();
      resetProductForm();

      // Cleanup
      setEditingProduct(null);
      setAdditionalImages([]);
      setProductVariations([]);
      setNewVariation({ color: "", size: "", quantity: "" });

    } catch (err) {
      console.error("Error updating product:", err);
      alert("Failed to update product.");
    } finally {
      setIsProductUploading(false);
    }
  };


  const handleDeleteProduct = async (product) => {
    if (!window.confirm("Are you sure you want to delete this product?")) {
      return;
    }

    try {
      /* -----------------------------------------
         STEP 1: COLLECT ALL IMAGE URLS
      ------------------------------------------ */
      const imageUrls = [
        product.image,
        ...(product.additionalImages || []),
      ];

      /* -----------------------------------------
         STEP 2: DELETE ALL IMAGES FROM STORAGE
      ------------------------------------------ */
      for (const url of imageUrls) {
        if (url) {
          try {
            const imageRef = ref(storage, url);
            await deleteObject(imageRef);
          } catch (err) {
            console.warn("Failed to delete image:", url, err);
            // Continue deleting others even if one fails
          }
        }
      }

      /* -----------------------------------------
         STEP 3: DELETE PRODUCT DOCUMENT
      ------------------------------------------ */
      const productDocRef = doc(
        db,
        "collections",
        selectedMainCollectionId,
        "subcollections",
        product.subcollectionId || selectedSubcollectionId,
        product.destination || "products",
        product.id
      );

      await deleteDoc(productDocRef);

      // Quick-added products own their subcollection; remove it as well so the
      // one-product/one-subcollection relationship stays consistent.
      const productSubcollectionData = product.subcollectionData || selectedSubcollectionData;
      if (productSubcollectionData?.autoCreatedForProduct) {
        await deleteDoc(doc(
          db, "collections", selectedMainCollectionId, "subcollections", product.subcollectionId || selectedSubcollectionId
        ));
        if ((product.subcollectionId || selectedSubcollectionId) === selectedSubcollectionId) {
          setSelectedSubcollectionId('');
          setSelectedSubcollectionData(null);
        }
        await fetchSubcollections();
      } else {
        await fetchProducts();
      }
      await fetchAllCollectionProducts();
      alert("Product deleted successfully!");

    } catch (err) {
      console.error("Error deleting product:", err);
      alert("Failed to delete product.");
    }
  };

  const filteredAndSortedUsers = [...users]

    /* =========================
       🔍 FILTER
       ========================= */
    .filter((user) => {
      const value = userSearchValue.toLowerCase().trim();
      if (!value) return true;

      const stats = userOrderStats[user.id] || {};

      switch (userSearchColumn) {
        case 'name':
          return user.name?.toLowerCase().includes(value);

        case 'mobile':
          return user.mobile?.toLowerCase().includes(value);

        case 'address':
          return user.address?.toLowerCase().includes(value);

        case 'role':
          return user.role?.toLowerCase().includes(value);

        case 'lastLogin':
          return formatDate(user.lastLogin)
            ?.toLowerCase()
            .includes(value);

        case 'lastOrder':
          return formatDate(stats.lastOrderDate)
            ?.toLowerCase()
            .includes(value);

        case 'orders':
          return String(stats.totalOrders || 0).includes(value);

        case 'amount':
          return String(stats.lifetimeValue || 0).includes(value);

        /* 🔥 ADD PROFIT FILTER */
        case 'profit':
          return String(stats.lifetimeProfit || 0).includes(value);

        case 'createdAt':
          return formatDate(user.createdAt)
            ?.toLowerCase()
            .includes(value);

        default:
          return true;
      }
    })

    /* =========================
       🔃 SORT
       ========================= */
    .sort((a, b) => {
      const statsA = userOrderStats[a.id] || {};
      const statsB = userOrderStats[b.id] || {};

      let valA;
      let valB;

      switch (userSortField) {
        case 'name':
          valA = a.name || '';
          valB = b.name || '';
          break;

        case 'orders':
          valA = statsA.totalOrders || 0;
          valB = statsB.totalOrders || 0;
          break;

        case 'amount':
          valA = statsA.lifetimeValue || 0;
          valB = statsB.lifetimeValue || 0;
          break;

        /* 🔥 ADD PROFIT SORT */
        case 'profit':
          valA = statsA.lifetimeProfit || 0;
          valB = statsB.lifetimeProfit || 0;
          break;

        case 'lastLogin':
          valA = a.lastLogin?.toDate?.() || new Date(0);
          valB = b.lastLogin?.toDate?.() || new Date(0);
          break;

        case 'lastOrder':
          valA = statsA.lastOrderDate?.toDate?.() || new Date(0);
          valB = statsB.lastOrderDate?.toDate?.() || new Date(0);
          break;

        case 'createdAt':
          valA = a.createdAt?.toDate?.() || new Date(0);
          valB = b.createdAt?.toDate?.() || new Date(0);
          break;

        default:
          return 0;
      }

      if (valA < valB) return userSortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return userSortOrder === 'asc' ? 1 : -1;
      return 0;
    });




  // Corrected handleToggleHighlight function (located in AdminPage.jsx)
  // Assuming selectedMainCollectionId and selectedSubcollectionId are managed with useState

  const handleToggleHighlight = async (productId, tagToToggle) => {
    // 🛑 CRITICAL FIX: Use the correct variable name: selectedMainCollectionId 🛑
    if (!productId || !selectedMainCollectionId || !selectedSubcollectionId) {
      console.error("Cannot update highlight: Missing Collection or Product IDs.");
      return;
    }

    // 1. Find the product and determine the new tags array
    const productToUpdate = products.find(p => p.id === productId);
    if (!productToUpdate) return;

    const currentTags = productToUpdate.tags || [];
    let newTags;

    if (currentTags.includes(tagToToggle)) {
      // Tag exists: Remove it (Toggle OFF)
      newTags = currentTags.filter(tag => tag !== tagToToggle);
    } else {
      // Tag doesn't exist: Add it (Toggle ON)
      newTags = [...currentTags, tagToToggle];
    }

    try {
      // 2. Update Firestore using the corrected variable names
      const productRef = doc(
        db,
        'collections',
        selectedMainCollectionId, // ⬅️ CORRECTED NAME
        'subcollections',
        selectedSubcollectionId,
        productToUpdate.destination || 'products',
        productId
      );

      await updateDoc(productRef, {
        tags: newTags
      });

      // 3. Update local state to immediately refresh the UI
      setProducts(prevProducts => prevProducts.map(p =>
        p.id === productId ? { ...p, tags: newTags } : p
      ));

      console.log(`Product ${productId} toggled highlight: ${tagToToggle}. New tags: ${newTags.join(', ')}`);

    } catch (error) {
      console.error("Error updating product highlight:", error);
      alert("Failed to update product highlight status.");
    }
  };




  // NEW: useEffect to fetch reports data
  useEffect(() => {
    const fetchReports = async () => {
      if (activeTab === 'reports') {
        setIsReportsLoading(true);
        try {
          const ordersRef = collection(db, 'orders');
          const ordersSnapshot = await getDocs(ordersRef);
          const ordersData = ordersSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            createdAt: doc.data().createdAt?.toDate().toLocaleDateString(),
          }));

          setOrderReports(ordersData);

          const paymentsData = ordersData.map(order => ({
            orderId: order.id,
            totalAmount: order.totalAmount,
            paymentMethod: order.paymentMethod || 'N/A',
            status: order.status,
            date: order.createdAt,
          }));

          setPaymentReports(paymentsData);

          // Fetch all products to generate the product report
          const productsRef = collection(db, 'products');
          const productsSnapshot = await getDocs(productsRef);
          const allProducts = productsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

          const productSales = {};
          ordersData.forEach(order => {
            order.items.forEach(item => {
              if (!productSales[item.productCode]) {
                productSales[item.productCode] = { quantity: 0, revenue: 0 };
              }
              productSales[item.productCode].quantity += item.quantity;
              productSales[item.productCode].revenue += item.quantity * item.price;
            });
          });

          const reports = allProducts.map(product => ({
            productName: product.productName,
            productCode: product.productCode,
            quantityInStock: product.quantity,
            totalSales: productSales[product.productCode]?.quantity || 0,
            totalRevenue: productSales[product.productCode]?.revenue || 0,
          }));

          setProductReports(reports);

        } catch (error) {
          console.error("Error fetching reports:", error);
        }
        setIsReportsLoading(false);
      }
    };
    fetchReports();
  }, [activeTab]);

  const resetProductForm = () => {
    setProductName(''); // Reset new field
    setProductCode('');
    setProductQuantity('');
    setEditingProduct(null);
    setShowProductForm(false);
    setProductDestination("");
    setDeodapRawJson('');
    setDeodapRawData({});
    setDeodapFields({
      sku: '', tags: '', compareAtPrice: '', discountPercentage: '', vendor: '',
      productType: '', descriptionHtml: '', descriptionText: '', keyFeatures: '', faqs: '[]',
      source: 'deodap.in', productUrl: '', handle: '', available: true,
    });
    setNewProducts([]);
    setCurrentImageIndex(0);
  };

  // NEW: Filter products based on search term
  const productListForManagement = productEntryMode === 'manage' ? allCollectionProducts : products;
  const filteredProducts = productListForManagement.filter(product => {
    const searchTerm = productSearchTerm.toLowerCase();
    return (product.productName || '').toLowerCase().includes(searchTerm)
      || (product.productCode || '').toLowerCase().includes(searchTerm)
      || (product.subcollectionName || '').toLowerCase().includes(searchTerm);
  });
  const fetchMainCollectionsForOffline = async () => {
    setIsOfflineProductsLoading(true);
    try {
      const querySnapshot = await getDocs(collection(db, 'collections'));
      const fetchedCollections = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      }));
      setMainCollections(fetchedCollections);
    } catch (error) {
      console.error('Error fetching main collections for offline billing:', error);
    }
    setIsOfflineProductsLoading(false);
  };

  // 🔑 IMPORTANT: Use the actual deployed URL you provided
  const FIREBASE_CANCEL_ORDER_URL = "https://us-central1-jewellerywholesale-2e57c.cloudfunctions.net/cancelOrder";

  // Add this function inside your AdminPage component, next to handleUpdateOrderStatus
  const handleCancelOrder = async (orderId) => {
    if (!window.confirm(`Are you sure you want to cancel Order ID: ${orderId}? This action will reverse stock quantities.`)) {
      return;
    }

    // Assuming you have a loading state to prevent double-clicks
    // setIsProcessing(true);

    try {
      const response = await fetch(FIREBASE_CANCEL_ORDER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ orderId: orderId }),
      });

      const result = await response.json();

      if (response.ok) {
  alert(result.message);

  setSelectedOrder(prev =>
    prev
      ? {
          ...prev,
          status: "Cancelled",
        }
      : prev
  );
} else {
        alert(`Cancellation Failed: ${result.error || 'An unknown error occurred.'}`);
      }
    } catch (error) {
      console.error("Error cancelling order:", error);
      alert("Network error. Could not connect to the cancellation service.");
    }
    // finally {
    //    // setIsProcessing(false); 
    // }
  };




  const recalculateOfflineCartPrices = (currentCart) => {
    const newCart = { ...currentCart };
    const pricingGroups = {};

    // Group products in the cart by their unique pricing ID
    for (const productId in newCart) {
      const item = newCart[productId];
      // This is the correct way to get the pricing tiers from the subcollection
      const itemPricingTiers = item.tieredPricing?.[offlinePricingKey];
      const pricingId = JSON.stringify(itemPricingTiers);

      if (!pricingGroups[pricingId]) {
        pricingGroups[pricingId] = [];
      }
      pricingGroups[pricingId].push(item);
    }

    // Recalculate and update the price for each group
    for (const pricingId in pricingGroups) {
      const groupItems = pricingGroups[pricingId];
      const totalGroupQuantity = groupItems.reduce((total, item) => total + item.quantity, 0);
      const tiers = groupItems[0].tieredPricing?.[offlinePricingKey];
      const groupPrice = getPriceForQuantity(tiers, totalGroupQuantity);

      groupItems.forEach(item => {
        newCart[item.id].price = groupPrice;
      });
    }
    return newCart;
  };

  const fetchSubcollectionsForOffline = async (mainCollectionId) => {
    setIsOfflineProductsLoading(true);
    try {
      const subcollectionsRef = collection(db, 'collections', mainCollectionId, 'subcollections');
      const querySnapshot = await getDocs(subcollectionsRef);
      const fetchedSubcollections = [];
      const newSubcollectionsMap = {};

      querySnapshot.docs.forEach(doc => {
        const data = { id: doc.id, ...doc.data() };
        fetchedSubcollections.push(data);
        newSubcollectionsMap[doc.id] = data;
      });

      setOfflineSubcollections(fetchedSubcollections);
      setSubcollectionsMap(newSubcollectionsMap);
    } catch (error) {
      console.error('Error fetching subcollections for offline billing:', error);
    } finally {
      setIsOfflineProductsLoading(false);
    }
  };

  // Fast POS loading: fetch all selected subcollections concurrently instead of
  // waiting for each Firestore request one after another.
  const fetchOfflineProducts = async () => {
    if (!selectedOfflineCollectionId) {
      setOfflineProducts([]);
      return;
    }

    const subcollectionIds = selectedOfflineSubcollectionId
      ? [selectedOfflineSubcollectionId]
      : (offlineSubcollections.length
          ? offlineSubcollections.map((item) => item.id)
          : Object.keys(subcollectionsMap));

    if (!subcollectionIds.length) {
      setOfflineProducts([]);
      return;
    }

    setIsOfflineProductsLoading(true);
    try {
      const snapshotsBySubcollection = await Promise.all(
        subcollectionIds.map(async (subId) => {
          const basePath = ['collections', selectedOfflineCollectionId, 'subcollections', subId];
          const [productsSnap, appProductsSnap] = await Promise.all([
            getDocs(collection(db, ...basePath, 'products')),
            getDocs(collection(db, ...basePath, 'appProducts')),
          ]);
          return { subId, productsSnap, appProductsSnap };
        })
      );

      const allProducts = [];
      for (const { subId, productsSnap, appProductsSnap } of snapshotsBySubcollection) {
        const subData = subcollectionsMap[subId] ||
          offlineSubcollections.find((item) => item.id === subId) || {};
        const appendOfflineProduct = (docSnap, destination) => {
          const data = docSnap.data();
          allProducts.push({
            ...data,
            id: docSnap.id,
            productDocumentId: docSnap.id,
            destination,
            gstRate: data.gstRate ?? data.gst_rate ?? subData.gstRate ?? 0,
            gstType: data.gstType ?? data.gst_type ?? subData.gstType ?? 'exclusive',
            purchaseRate: data.purchaseRate ?? data.purchasePrice ?? subData.purchaseRate ?? subData.purchasePrice ?? 0,
            retailPrice: data.retailPrice ?? data.salePrice ?? data.price ?? subData.retailPrice ?? subData.salePrice ?? subData.price ?? 0,
            price: data.price ?? data.retailPrice ?? data.salePrice ?? subData.price ?? subData.retailPrice ?? subData.salePrice ?? 0,
            tieredPricing: subData.tieredPricing || data.tieredPricing,
            subcollectionId: subId,
            collectionId: selectedOfflineCollectionId,
          });
        };
        productsSnap.forEach((docSnap) => appendOfflineProduct(docSnap, 'products'));
        appProductsSnap.forEach((docSnap) => appendOfflineProduct(docSnap, 'appProducts'));
      }

      // Keep the UI snappy when the same collection is opened again.
      const cacheKey = `offlinePosProducts:${selectedOfflineCollectionId}:${selectedOfflineSubcollectionId || 'all'}`;
      try { sessionStorage.setItem(cacheKey, JSON.stringify(allProducts)); } catch (_) {}
      setOfflineProducts(allProducts);
    } catch (error) {
      console.error('Error fetching offline products:', error);
      setOfflineProducts([]);
    } finally {
      setIsOfflineProductsLoading(false);
    }
  };

  const handleExportUsers = () => {
    if (!filteredAndSortedUsers.length) return;

    const headers = [
      "Name",
      "Role",
      "Mobile",
      "Address",
      "Last Login",
      "Last Order",
      "Total Orders",
      "Total Amount",
      "Created At",
    ];

    const rows = filteredAndSortedUsers.map((user) => {
      const stats = userOrderStats[user.id] || {};

      return [
        user.name || "",
        user.role || "",
        user.mobile || "",
        user.address || "",
        formatDate(user.lastLogin),
        stats.lastOrderDate ? formatDate(stats.lastOrderDate) : "",
        stats.totalOrders || 0,
        stats.lifetimeValue || 0,
        formatDate(user.createdAt),
      ];
    });

    const csvContent = [
      headers.join(","),
      ...rows.map((row) =>
        row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
      ),
    ].join("\n");

    const blob = new Blob([csvContent], {
      type: "text/csv;charset=utf-8;",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.setAttribute(
      "download",
      `users_export_${new Date().toISOString().slice(0, 10)}.csv`
    );

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };


  const handleOfflineRemoveFromCart = (cartItemId) => {
    setOfflineCart((prevCart) => {
      const current = prevCart[cartItemId];
      if (!current) return prevCart;
      const nextQuantity = (Number(current.quantity) || 0) - 1;
      const nextCart = { ...prevCart };
      if (nextQuantity <= 0) delete nextCart[cartItemId];
      else nextCart[cartItemId] = { ...current, quantity: nextQuantity };
      return nextCart;
    });
  };

  // Cart controls update the exact key rendered by the cart; they do not
  // recalculate an ID from an already-enriched cart item.
  const handleOfflineIncrementCartItem = (cartItemId) => {
    setOfflineCart((prevCart) => {
      const current = prevCart[cartItemId];
      if (!current) return prevCart;
      const stock = Number(current.availableStock ?? current.quantity ?? 0);
      if (Number(current.quantity || 0) >= stock) return prevCart;
      return {
        ...prevCart,
        [cartItemId]: { ...current, quantity: Number(current.quantity || 0) + 1 },
      };
    });
  };

  // NOTE: Assuming you have access to db, doc, getDoc, and getPriceForQuantity helper
  // If this function is in a component, you may need to import those Firestore functions.
  // --- Function to calculate the final price per item and the total ---
  // NOTE: This logic replaces or is integrated into your existing getOfflineCartTotal logic
  const calculatePricedCart = async () => {
    const cartItems = Object.values(offlineCart);
    if (cartItems.length === 0) {
      return { updatedCartMap: {}, total: 0 };
    }

    const subcollectionPricingMap = {};
    const updatedCartMap = { ...offlineCart };

    // ✅ pricing key comes from role-based system
    const pricingTypeKey = offlinePricingKey;

    /* -----------------------------------
       PHASE 1: GROUP ITEMS + FETCH PRICING
    ----------------------------------- */
    for (const item of cartItems) {
      const subcollectionId = item.subcollectionId;
      const collectionId = item.collectionId;
      const pricingGroupKey = `${collectionId}__${subcollectionId}`;
      const quantitySold = Number(item.quantity) || 0;

      if (!subcollectionPricingMap[pricingGroupKey]) {
        const subcollectionRef = doc(
          db,
          'collections',
          collectionId,
          'subcollections',
          subcollectionId
        );

        const subcollectionDoc = await getDoc(subcollectionRef);

        if (!subcollectionDoc.exists()) {
          console.error(`Subcollection pricing not found: ${subcollectionId}`);
          continue;
        }

        subcollectionPricingMap[pricingGroupKey] = {
          pricingData: subcollectionDoc.data().tieredPricing || {},
          totalQuantity: 0,
          items: [],
        };
      }

      subcollectionPricingMap[pricingGroupKey].totalQuantity += quantitySold;
      subcollectionPricingMap[pricingGroupKey].items.push(item);
    }

    let runningTotal = 0;

    /* -----------------------------------
       PHASE 2: APPLY TIERED PRICING
    ----------------------------------- */
    for (const entry of Object.values(subcollectionPricingMap)) {
      const tiers = entry.pricingData?.[pricingTypeKey];
      const totalGroupQuantity = entry.totalQuantity;

      let finalPricePerUnit = null;

      if (Array.isArray(tiers) && tiers.length > 0) {
        const numericTiers = tiers.map(tier => ({
          min_quantity: Number(tier.min_quantity) || 0,
          max_quantity:
            tier.max_quantity !== undefined && tier.max_quantity !== null
              ? Number(tier.max_quantity)
              : Infinity,
          price: Number(tier.price) || 0,
        }));

        finalPricePerUnit = getPriceForQuantity(
          numericTiers,
          totalGroupQuantity
        );
      }

      // Apply calculated price to each item
      for (const item of entry.items) {
        const effectivePrice =
          typeof finalPricePerUnit === 'number'
            ? finalPricePerUnit
            : Number(item.price) || 0;

        updatedCartMap[item.id] = {
          ...updatedCartMap[item.id],
          calculatedPrice: effectivePrice,
        };

        runningTotal += effectivePrice * (Number(item.quantity) || 0);
      }
    }

    return {
      updatedCartMap,
      total: runningTotal,
    };
  };
  const fetchAllProductsForScan = async () => {
    console.log("Loading all products for product-code scanning...");
    try {
      const collectionsSnap = await getDocs(collection(db, "collections"));
      const map = {};
      const duplicateCodes = new Set();
      const duplicateNormalizedCodes = new Set();

      for (const col of collectionsSnap.docs) {
        const subsSnap = await getDocs(collection(db, "collections", col.id, "subcollections"));
        for (const sub of subsSnap.docs) {
          const subData = sub.data();
          const basePath = ["collections", col.id, "subcollections", sub.id];
          const [productsSnap, appProductsSnap] = await Promise.all([
            getDocs(collection(db, ...basePath, "products")),
            getDocs(collection(db, ...basePath, "appProducts")),
          ]);

          const addProduct = (docSnap, destination) => {
            const data = docSnap.data();
            const productCode = String(data.productCode || data.product_code || '').trim();
            if (!productCode) return;
            const normalizedCode = productCode.replace(/[\s\n\r\t]/g, '').toLowerCase();
            if (duplicateNormalizedCodes.has(normalizedCode)) return;
            if (map[normalizedCode]) {
              duplicateCodes.add(productCode);
              duplicateNormalizedCodes.add(normalizedCode);
              delete map[normalizedCode];
              console.warn(`Duplicate product code found while loading scanner: ${productCode}`);
              return;
            }
            map[normalizedCode] = {
              ...data,
              id: docSnap.id,
              productDocumentId: docSnap.id,
              productCode,
              destination,
              collectionId: col.id,
              subcollectionId: sub.id,
              tieredPricing: data.tieredPricing || subData.tieredPricing || {},
              gstRate: data.gstRate ?? data.gst_rate ?? subData.gstRate ?? 0,
              gstType: data.gstType ?? data.gst_type ?? subData.gstType ?? 'exclusive',
              retailPrice: data.retailPrice ?? data.salePrice ?? data.price ?? subData.retailPrice ?? subData.salePrice ?? subData.price ?? 0,
              price: data.price ?? data.retailPrice ?? data.salePrice ?? subData.price ?? subData.retailPrice ?? subData.salePrice ?? 0,
            };
          };
          productsSnap.forEach(d => addProduct(d, 'products'));
          appProductsSnap.forEach(d => addProduct(d, 'appProducts'));
        }
      }

      if (duplicateCodes.size) {
        console.error("Duplicate product codes detected; scanning is disabled for these ambiguous codes:", [...duplicateCodes]);
      }
      map.__duplicateCodes = [...duplicateNormalizedCodes];
      setAllProductsMap(map);
      localStorage.setItem("offlineProductsByCodeCacheV2", JSON.stringify(map));
    } catch (error) {
      console.error("Error loading products for barcode scan:", error);
    }
  };

  useEffect(() => {
    if (activeTab !== "offline-billing") return;

    const cached = localStorage.getItem(
      "offlineProductsByCodeCacheV2"
    );

    if (cached) {
      console.log("⚡ Loaded products from cache");

      setAllProductsMap(JSON.parse(cached));
    }

    // 🔄 ALWAYS refresh in background
    fetchAllProductsForScan();

  }, [activeTab]);


  useEffect(() => {
    if (
      Object.keys(allProductsMap).length > 0 &&
      !isScannerReadyPlayed
    ) {
      console.log("🔊 Scanner Ready");

      playSound(readySound);
      setIsScannerReadyPlayed(true);
    }
  }, [allProductsMap, isScannerReadyPlayed]);


  const handleBarcodeScan = (barcodeValue) => {

    /* ==============================
       🧹 SANITIZE BARCODE INPUT
    ============================== */
    const rawCode = String(barcodeValue);

    const code = rawCode
      .replace(/[\n\r\t]/g, "")     // Remove hidden chars
      .replace(/\s+/g, "")         // Remove spaces
      .replace(/[^a-zA-Z0-9]/g, "")// Remove noise
      .trim();

    const normalizedCode = code.toLowerCase();

    console.log(
      "📦 Barcode scanned:",
      code,
      "Length:",
      code.length
    );

    /* ==============================
       ⏳ PRODUCTS STILL LOADING
    ============================== */
    if (Object.keys(allProductsMap).filter(key => key !== '__duplicateCodes').length === 0) {

      playSound("/sounds/scan-error.mp3");

      alert(
        "⏳ Products are still loading. Please scan again."
      );

      return;
    }

    /* ==============================
       🔎 FIND PRODUCT (UPDATED)
    ============================== */
    const product = allProductsMap[normalizedCode];

    /* ==============================
       ❌ PRODUCT NOT FOUND
    ============================== */
    if (!product) {

      playSound("/sounds/scan-error.mp3");

      if ((allProductsMap.__duplicateCodes || []).includes(normalizedCode)) {
        alert(`Duplicate product code detected: ${code}. Fix the duplicate code in Firestore before scanning this item.`);
        return;
      }

      console.warn(
        "❌ Product not found for barcode:",
        code
      );

      alert(`❌ Product not found:\n${code}`);

      setTimeout(() => {
        barcodeInputRef.current?.focus();
      }, 50);

      return;
    }

    /* ==============================
       ✅ SUCCESS SOUND
    ============================== */
    playSound("/sounds/scan-success.mp3");

    console.log(
      "✅ Product found:",
      product.productName
    );

    /* ==============================
       🔥 LAST SCANNED POPUP
    ============================== */
    setLastScannedProduct({
      name: product.productName,
      code: product.productCode || product.id,
    });

    setTimeout(() => {
      setLastScannedProduct(null);
    }, 1500);

    /* ==============================
       📂 AUTO-SELECT FILTERS
    ============================== */
    setSelectedOfflineCollectionId(
      product.collectionId
    );

    setSelectedOfflineSubcollectionId(
      product.subcollectionId
    );

    /* ==============================
       🔀 VARIANT HANDLING
    ============================== */
  if (product.variations && product.variations.length > 1) {

  // 🔥 Multiple variants → open selection modal
  setVariantSelectionProduct(product);

} else if (product.variations && product.variations.length === 1) {

  const onlyVariant = product.variations[0];

  if (Number(onlyVariant.quantity) <= 0) {
    playSound("/sounds/scan-error.mp3");
    alert("Variant is out of stock.");
    return;
  }

  handleOfflineAddToCart(product, onlyVariant);

} else {

  // ✅ Simple product
  handleOfflineAddToCart(product, null);
}

// 🔁 Refocus scanner
setTimeout(() => {
  barcodeInputRef.current?.focus();
}, 50);
  };






  useEffect(() => {

    let isMounted = true;
    const updatePricedCart = async () => {
      if (Object.keys(offlineCart).length === 0) {
        if (isMounted) {
          setPricedOfflineCart({});
          setOfflineSubtotal(0);
        }
        return;
      }

      try {
        const { updatedCartMap, total } = await calculatePricedCart();

        if (isMounted) {
          setPricedOfflineCart(updatedCartMap);
          setOfflineSubtotal(total);
        }
      } catch (error) {
        console.error("Error calculating offline cart prices:", error);
      }
    };

    updatePricedCart();

    return () => { isMounted = false; };
    // Re-run whenever the cart contents or the pricing type changes
  }, [offlineCart, offlinePricingKey]);

  useEffect(() => {
    if (activeTab === "offline-billing") {
      barcodeInputRef.current?.focus();
    }
  }, [activeTab]);



  useEffect(() => {
    if (!isScanMode) return;

    const handleKeyPress = (e) => {
      if (activeTab !== "offline-billing") return;

      if (e.key === "Enter") {
        e.preventDefault();

        const code = scannedBarcode
          .replace(/[\n\r\t]/g, "")
          .replace(/\s+/g, "")
          .trim();

        if (!code) return;

        handleBarcodeScan(code);
        setScannedBarcode("");
      }
    };

    window.addEventListener("keydown", handleKeyPress);

    return () => {
      window.removeEventListener("keydown", handleKeyPress);
    };
  }, [scannedBarcode, activeTab, isScanMode]);




  useEffect(() => {
    if (!showCameraScanner) return;

    let html5QrCode;
    let isMounted = true;

    // ⚡ Laser-mode scan control
    let lastScanTime = 0;
    let lastScannedCode = null;

    const SCAN_DELAY = 300; // 🔥 Laser speed (ms)

    const startScanner = async () => {
      try {
        html5QrCode = new Html5Qrcode("camera-scanner");

        await html5QrCode.start(
          { facingMode: "environment" },
          {
            fps: 15, // 🔥 Faster frame rate
            qrbox: { width: 300, height: 120 },
            aspectRatio: 1.8,
          },

          // ==============================
          // ⚡ LASER SPEED SCAN
          // ==============================
          (decodedText) => {
            if (!isMounted) return;

            const now = Date.now();

            // 🚫 Prevent duplicate rapid scans
            if (
              decodedText === lastScannedCode &&
              now - lastScanTime < SCAN_DELAY
            ) {
              return;
            }

            lastScanTime = now;
            lastScannedCode = decodedText;

            console.log("⚡ Laser scan:", decodedText);

            // 🔊 Fast beep
            playSound("/sounds/scan-success.mp3");

            // Add to cart
            handleBarcodeScan(decodedText);

            // Stay on billing tab
            setActiveTab("offline-billing");
          },

          (err) => {
            // Ignore scan errors
          }
        );

      } catch (err) {
        console.error("Camera start error:", err);

        alert(
          "Camera failed to start.\n\n" +
          "Allow camera permission & use HTTPS."
        );
      }
    };

    startScanner();

    // ==============================
    // 🧹 CLEANUP
    // ==============================
    return () => {
      isMounted = false;

      if (html5QrCode) {
        html5QrCode
          .stop()
          .then(() => html5QrCode.clear())
          .catch(() => { });
      }
    };
  }, [showCameraScanner]);



  const handleFinalizeSale = async () => {
    if (Object.keys(offlineCart).length === 0) {
      alert('The cart is empty. Please add products to finalize the sale.');
      return;
    }
    const {
      fullName,
      phoneNumber,
      addressLine1,
      city,
      state,
      pincode,
    } = offlineCustomer;

    if (!fullName || !phoneNumber || !addressLine1 || !city || !state || !pincode) {
      alert('Please fill all required customer details.');
      return;
    }


    if (window.confirm('Are you sure you want to finalize this offline sale?')) {
      let isStockError = false;
      const productUpdatesMap = {};

      try {
        // ----------------------------------------------------
        // 🎯 PHASE 1: Aggregate Cart Items and Fetch Product Data
        // ----------------------------------------------------
        console.log(`\n--- STARTING OFFLINE SALE TRANSACTION PREP ---`);

        // Group by full Firestore path so different products with similar IDs never collide.
        for (const item of Object.values(offlineCart)) {
          const baseProductId = item.productDocumentId || String(item.id).split('_')[0];
          const destination = item.destination || 'products';
          const updateKey = `${item.collectionId}__${item.subcollectionId}__${destination}__${baseProductId}`;

          if (!productUpdatesMap[updateKey]) {
            const productRef = doc(db,
              'collections', item.collectionId,
              'subcollections', item.subcollectionId,
              destination, baseProductId
            );
            const productDoc = await getDoc(productRef);
            if (!productDoc.exists()) throw new Error(`Product not found: ${baseProductId}`);

            productUpdatesMap[updateKey] = {
              ref: productRef,
              data: productDoc.data(),
              cartItems: [],
              hasError: false,
              baseProductId,
            };
          }
          productUpdatesMap[updateKey].cartItems.push(item);
        }

        // 2. Process all cart items for each product to calculate the final stock
        const batch = writeBatch(db);

        for (const updateKey in productUpdatesMap) {
          const { ref: productRef, data: productData, cartItems, baseProductId } = productUpdatesMap[updateKey];

          // 🛑 CRITICAL FIX: Only treat as variations if the array exists AND has items.
          let currentVariations = (productData.variations && productData.variations.length > 0)
            ? [...productData.variations]
            : null;
          let currentSimpleQuantity = productData.quantity;

          // Iterate through all cart items that belong to THIS single product
          for (const item of cartItems) {
            const quantitySold = item.quantity;

            console.log(`\nProcessing Item: ${item.productName} (Variation: ${item.variation?.color || 'Simple'}) (Qty: ${quantitySold})`);

            // --- VARIATION LOGIC ---
            if (item.variation && currentVariations) {
              currentVariations = currentVariations.map(v => {
                const isMatch = (v.color === item.variation.color && v.size === item.variation.size);

                if (isMatch) {
                  let currentQuantity = Number(v.quantity) || 0;
                  let newQuantity = currentQuantity - quantitySold;

                  console.log(`  -> Stock BEFORE: ${currentQuantity}`);

                  if (newQuantity < 0) {
                    isStockError = true;
                    productUpdatesMap[updateKey].hasError = true;
                    console.error(`  ❌ STOCK ERROR: Requested ${quantitySold}, but only ${currentQuantity} available.`);
                    return v;
                  }

                  // Update the variation's quantity in our temporary array
                  return { ...v, quantity: newQuantity };
                }
                return v;
              });

              // --- SIMPLE PRODUCT LOGIC ---
            } else if (!item.variation) {
              currentSimpleQuantity = Number(currentSimpleQuantity) || 0;
              let newQuantity = currentSimpleQuantity - quantitySold;

              console.log(`  -> Type: Simple Product`);
              console.log(`  -> Stock BEFORE: ${currentSimpleQuantity}`);

              if (newQuantity < 0) {
                isStockError = true;
                productUpdatesMap[updateKey].hasError = true;
                // ✅ FIX (from previous error): Log the correct variable
console.error(
  `❌ STOCK ERROR:
Product: ${item.productName}
Code: ${item.productCode}
Variation: ${item.variation?.size || "Simple"}

Requested: ${quantitySold}
`
);              } else {
                currentSimpleQuantity = newQuantity; // Update the temporary quantity
              }
            }
          }

          // 3. Add ONE FINAL UPDATE to the batch for this base product ID
          if (!productUpdatesMap[updateKey].hasError) {
            let finalUpdateData = {};
            let finalQtyLog = '';

            // The correct update is determined by the modified variable (currentVariations will be null for simple products now)
            if (currentVariations) {
              finalUpdateData = { variations: currentVariations };
              finalQtyLog = 'Variations Array Updated';
            } else {
              finalUpdateData = { quantity: currentSimpleQuantity };
              finalQtyLog = currentSimpleQuantity;
            }

            batch.update(productRef, finalUpdateData);

            // 🎯 LOG FINAL STOCK
            console.log(`  ✅ FINAL Stock AFTER: ${finalQtyLog}`);
            console.log(`  -> Batch updated for ${baseProductId}.`);
          }
        } // End of productUpdatesMap loop


        // 4. EXECUTE WRITES (Order Save and Stock Update)
        if (isStockError) {
          console.log(`\n--- TRANSACTION ROLLED BACK (Due to Stock Error) ---`);
          throw new Error("STOCK_FAILURE_CLIENT");
        }

        // ... (The rest of the order data construction remains unchanged) ...

        const baseTotal = editedTotal !== '' ? Math.max(0, Number(editedTotal) || 0) : Number(offlineSubtotal);
        const gstValue = offlineGstSummary.taxAmount;
        const addedGstValue = offlineGstSummary.addedTax;
        const shippingValue = isShippingApplied ? SHIPPING_CHARGE : 0;
        const totalAmountToUse = baseTotal + addedGstValue + shippingValue;

        // Billing Info (Unchanged)


        const offlineSaleCustomerInfo = {
          fullName: `${offlineCustomer.fullName} (Offline)`,
          email: offlineCustomer.email || '',
          phoneNumber: offlineCustomer.phoneNumber,
          addressLine1: offlineCustomer.addressLine1,
          addressLine2: offlineCustomer.addressLine2 || '',
          city: offlineCustomer.city,
          state: offlineCustomer.state,
          pincode: offlineCustomer.pincode,
          gst: offlineCustomer.gst || '',
        };


        // Order Items (Using correctly calculated price)
        const orderItems = Object.values(pricedOfflineCart).map(item => {
          const unitPrice = typeof item.calculatedPrice === 'number' ? item.calculatedPrice : Number(item.price) || 0;
          const lineSubtotal = unitPrice * (Number(item.quantity) || 0);
          const gst = getProductGstDetails(item, lineSubtotal);
          return {
            productId: item.productDocumentId || String(item.id).split('_')[0] || 'N/A',
            productName: item.productName || 'N/A',
            productCode: item.productCode || 'N/A',
            quantity: item.quantity || 0,
            priceAtTimeOfOrder: unitPrice,
            price: unitPrice,
            lineSubtotal,
            gstRate: gst.rate,
            gstType: gst.type,
            gstAmount: gst.tax,
            gstAddedToTotal: gst.addedTax,
            image: item.image || '',
            images: item.images || [],
            variation: item.variation || null,
            subcollectionId: item.subcollectionId,
            collectionId: item.collectionId,
            destination: item.destination || 'products',
          };
        });


        const orderData = {
          userId: 'offline-sale',
          status: 'Pending',
          createdAt: serverTimestamp(),
          billingInfo: offlineSaleCustomerInfo,
          items: orderItems,
          subtotal: baseTotal,
          gstApplied: gstValue > 0,
          gstCalculation: 'per-product',
          gstRate: null,
          gstAmount: gstValue,
          gstAddedToTotal: addedGstValue,
          totalAmount: totalAmountToUse,
          shippingFee: shippingValue,
          paymentMethod: offlinePaymentMethod,
          pricingKey: offlinePricingKey,
          role: ROLE_KEYS.find(
            r => ROLE_CONFIG[r].pricingKey === offlinePricingKey
          ),

        };

        const orderRef = await addDoc(collection(db, 'orders'), orderData);
        console.log(`✅ Order added to Firestore successfully with ID: ${orderRef.id}`);



        await batch.commit();
        console.log('✅ All Stock quantities updated successfully!');
        console.log('------------------------------------------');
        setInvoiceData({
          customer: offlineSaleCustomerInfo,
          items: orderItems,
          subtotal: baseTotal,
          gstRate: null,
          shippingFee: shippingValue,
          gstAmount: gstValue,
          gstAddedToTotal: addedGstValue,
          includedGstAmount: offlineGstSummary.includedTax,
          paymentMethod: offlinePaymentMethod,
          total: totalAmountToUse,
          invoiceDate: new Date(),
          invoiceNumber: orderRef.id,
        });

        setShowInvoice(true);



        // 5. Success and Cleanup
        alert('Offline sale finalized and stock updated successfully!');
        setOfflineCart({});

// ✅ REMOVE DRAFT FROM LOCALSTORAGE
localStorage.removeItem("offlineCartDraft");

// Optional: if you later saved full billing draft
localStorage.removeItem("offlineBillingDraft");
        setEditedTotal('');
        setOfflinePaymentMethod('Cash');
        setSelectedOfflineCollectionId('');
        setSelectedOfflineSubcollectionId('');
        setOfflineProducts([]);
        setOfflineCustomer({
          fullName: '',
          email: '',
          phoneNumber: '',
          addressLine1: '',
          addressLine2: '',
          city: '',
          state: '',
          pincode: '',
        });


        if (activeTab === 'orders') fetchOrders();
        if (activeSubTab === 'products') fetchProducts(selectedSubcollectionId);

      } catch (error) {
        if (error.message === "STOCK_FAILURE_CLIENT") {
const stockErrorMessages = [];

for (const item of Object.values(offlineCart)) {
  const baseProductId = item.productDocumentId || String(item.id).split('_')[0];
  const updateKey = `${item.collectionId}__${item.subcollectionId}__${item.destination || 'products'}__${baseProductId}`;
  const productData = productUpdatesMap[updateKey];

  if (productData?.hasError) {

    stockErrorMessages.push(
`❌ ${item.productName}
Code: ${item.productCode}
Variation: ${item.variation?.size || "Simple"}

Requested: ${item.quantity}`
    );
  }
}

alert(
  `Insufficient Stock:\n\n${stockErrorMessages.join("\n----------------\n")}`
);        } else {
          console.error('\n--- FINAL ERROR ---');
          console.error('Error finalizing offline sale:', error);
          alert('Failed to finalize the sale. Please check console for details.');
        }
      }
    }
  };

  // Build a receipt from the CURRENT cart only. This does not create an order or update stock.
  const handlePrintCurrentCart = () => {
    const currentItems = Object.values(pricedOfflineCart || {});
    if (!currentItems.length) {
      alert("Your cart is empty. Add products before printing.");
      return;
    }

    const cartItems = currentItems.map((item) => {
      const unitPrice = typeof item.calculatedPrice === "number"
        ? item.calculatedPrice
        : Number(item.price) || 0;
      const lineSubtotal = unitPrice * (Number(item.quantity) || 0);
      const gst = getProductGstDetails(item, lineSubtotal);
      return {
        productId: item.productDocumentId || String(item.id).split("_")[0] || "N/A",
        productName: item.productName || item.name || "Item",
        productCode: item.productCode || "N/A",
        quantity: Number(item.quantity) || 0,
        price: unitPrice,
        gstRate: gst.rate,
        gstType: gst.type,
        gstAmount: gst.tax,
        variation: item.variation || null,
      };
    });

    const customerInfo = {
      fullName: offlineCustomer.fullName || "Walk-in Customer",
      email: offlineCustomer.email || "",
      phoneNumber: offlineCustomer.phoneNumber || "",
      addressLine1: offlineCustomer.addressLine1 || "",
      addressLine2: offlineCustomer.addressLine2 || "",
      city: offlineCustomer.city || "",
      state: offlineCustomer.state || "",
      pincode: offlineCustomer.pincode || "",
      gst: offlineCustomer.gst || "",
    };

    setIsCartPreviewReceipt(true);
    setInvoiceData({
      customer: customerInfo,
      items: cartItems,
      subtotal: baseTotal,
      gstRate: null,
      shippingFee: shippingValue,
      gstAmount: gstAmount,
      gstAddedToTotal: offlineGstSummary.addedTax,
      includedGstAmount: offlineGstSummary.includedTax,
      paymentMethod: offlinePaymentMethod,
      total: finalTotal,
      invoiceDate: new Date(),
      invoiceNumber: "CURRENT-CART",
    });
    setShowInvoice(true);
  };

  const handleClearOfflineCart = () => {

  if (!window.confirm("Clear entire offline cart?")) {
    return;
  }

  // Clear React state
  setOfflineCart({});

  // Clear saved draft
  localStorage.removeItem("offlineCartDraft");
  localStorage.removeItem("offlineBillingDraft");

  // Optional extra reset
  setEditedTotal('');

  alert("Offline cart cleared.");
};
  useEffect(() => {
    if (!showInvoice || !invoiceData || isCartPreviewReceipt) return;

    const processInvoicePDF = async () => {
      try {
        // ⏳ wait for DOM paint
        await new Promise(res => setTimeout(res, 500));

        const pdfUrl = await uploadInvoicePDF(invoiceData.invoiceNumber);

        if (!pdfUrl) return;

        // save pdf url to order
        const orderRef = doc(db, "orders", invoiceData.invoiceNumber);
        await updateDoc(orderRef, { invoicePdfUrl: pdfUrl });

        // optional WhatsApp
        if (sendInvoiceOnWhatsApp) {
          const phone = invoiceData.customer.phoneNumber.replace(/\D/g, "");
          const message = encodeURIComponent(
            `Thank you for your purchase.\n\nInvoice PDF:\n${pdfUrl}`
          );
          window.open(`https://wa.me/91${phone}?text=${message}`, "_blank");
        }

      } catch (err) {
        console.error("Invoice PDF generation failed:", err);
      }
    };

    processInvoicePDF();

  }, [showInvoice, invoiceData, isCartPreviewReceipt]);

  useEffect(() => {
    const afterPrint = () => { setShowInvoice(false); setIsCartPreviewReceipt(false); };

    window.addEventListener('afterprint', afterPrint);
    return () => window.removeEventListener('afterprint', afterPrint);
  }, []);

  useEffect(() => {
    if (selectedOfflineCollectionId) {
      fetchSubcollectionsForOffline(selectedOfflineCollectionId);
    } else {
      setOfflineSubcollections([]);
      setSubcollectionsMap({});
    }
  }, [selectedOfflineCollectionId]);

  // This useEffect is critical for updating the products whenever the subcollection changes.
  // It ensures that products are loaded with the correct tiered pricing data.
  useEffect(() => {
    if (selectedOfflineCollectionId) {
      fetchOfflineProducts();
    }
  }, [selectedOfflineCollectionId, selectedOfflineSubcollectionId, subcollectionsMap]);


  const filteredOfflineProducts = offlineProducts.filter(product =>
    product && (
      (product.productName && product.productName.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (product.productCode && product.productCode.toLowerCase().includes(searchQuery.toLowerCase()))
    )
  );

  const formatDate = (timestamp) => {
    if (!timestamp) {
      return 'N/A';
    }

    let date;

    // 1. Handle Firebase Timestamp (preferred method for Firestore data)
    if (typeof timestamp.toDate === 'function') {
      date = timestamp.toDate();
    }
    // 2. Handle standard Date object
    else if (timestamp instanceof Date) {
      date = timestamp;
    }
    // 3. Handle string or number representing a date
    else if (typeof timestamp === 'string' || typeof timestamp === 'number') {
      date = new Date(timestamp);
    }

    // 4. Final validation: check if the resulting date object is valid
    if (date && !isNaN(date.getTime())) {
      // Use toLocaleDateString() for a user-friendly, locale-specific format
      return date.toLocaleDateString();
    }

    return 'N/A';
  };

  // Count users by role
  const wholesalerCount = filteredAndSortedUsers.filter(user => user.role === 'wholesaler').length;
  const retailerCount = filteredAndSortedUsers.filter(user => user.role === 'retailer').length;
  const handleMoveOutOfStockToTrash = async () => {
    if (trashRunning) return;

    const confirm = window.confirm(
      "Out-of-stock products / variants will be moved to Trash.\n\nContinue?"
    );
    if (!confirm) return;

    setTrashRunning(true);
    setTrashProgress(0);

    try {
      let trashedProducts = 0;
      let trashedVariants = 0;

      const collectionsSnap = await getDocs(collection(db, "collections"));

      // 🔢 STEP COUNT (for progress)
      let totalProducts = 0;
      for (const col of collectionsSnap.docs) {
        const subSnap = await getDocs(
          collection(db, "collections", col.id, "subcollections")
        );
        for (const sub of subSnap.docs) {
          const productsSnap = await getDocs(
            collection(
              db,
              "collections",
              col.id,
              "subcollections",
              sub.id,
              "products"
            )
          );
          totalProducts += productsSnap.size;
        }
      }

      if (totalProducts === 0) {
        alert("No products found.");
        setTrashRunning(false);
        return;
      }

      let processed = 0;

      for (const col of collectionsSnap.docs) {
        const subSnap = await getDocs(
          collection(db, "collections", col.id, "subcollections")
        );

        for (const sub of subSnap.docs) {
          const productsRef = collection(
            db,
            "collections",
            col.id,
            "subcollections",
            sub.id,
            "products"
          );

          const productsSnap = await getDocs(productsRef);

          for (const prod of productsSnap.docs) {
            const data = prod.data();
            const productRef = doc(
              db,
              "collections",
              col.id,
              "subcollections",
              sub.id,
              "products",
              prod.id
            );

            /* ===== VARIANTS ===== */
            if (Array.isArray(data.variations) && data.variations.length > 0) {
              const activeVariants = [];

              for (const variant of data.variations) {
                if (Number(variant.quantity) <= 0) {
                  await setDoc(
                    doc(
                      db,
                      "trash_variants",
                      `${prod.id}_${variant.sku || variant.name}`
                    ),
                    {
                      productId: prod.id,
                      collectionId: col.id,
                      subcollectionId: sub.id,
                      variant,
                      deletedAt: serverTimestamp(),
                      deletedBy: "admin",
                    }
                  );
                  trashedVariants++;
                } else {
                  activeVariants.push(variant);
                }
              }

              if (activeVariants.length === 0) {
                await setDoc(doc(db, "trash_products", prod.id), {
                  ...data,
                  originalPath: {
                    collectionId: col.id,
                    subcollectionId: sub.id,
                  },
                  deletedAt: serverTimestamp(),
                  deletedBy: "admin",
                });

                await deleteDoc(productRef);
                trashedProducts++;
              } else {
                const totalQty = activeVariants.reduce(
                  (s, v) => s + Number(v.quantity || 0),
                  0
                );

                await updateDoc(productRef, {
                  variations: activeVariants,
                  quantity: totalQty,
                });
              }
            }

            /* ===== SIMPLE PRODUCT ===== */
            else if (Number(data.quantity) <= 0) {
              await setDoc(doc(db, "trash_products", prod.id), {
                ...data,
                originalPath: {
                  collectionId: col.id,
                  subcollectionId: sub.id,
                },
                deletedAt: serverTimestamp(),
                deletedBy: "admin",
              });

              await deleteDoc(productRef);
              trashedProducts++;
            }

            // 📈 PROGRESS UPDATE
            processed++;
            setTrashProgress(
              Math.round((processed / totalProducts) * 100)
            );
          }
        }
      }

      alert(
        `Completed!\n\n🗑 Products: ${trashedProducts}\n🧹 Variants: ${trashedVariants}`
      );
    } catch (err) {
      console.error("Trash cleanup failed:", err);
      alert("Trash operation failed. Check console.");
    } finally {
      setTrashRunning(false);
      setTrashProgress(0);
    }
  };

  const ROLE_PERMISSIONS = {
    superadmin: [
      "collections",
      "orders",
      "lowStock",
      "Storestock",
      "reports",
      "users",
      "offline-billing",
      "leads",
      "coupons",
      "editOrders",
      "barcode",
      "sellerprofit",
      "storeorders",
      "adminsellers",
      "custombill",
      "dailyorders"
    ],

    manager: [
      "orders",
      "reports",
      "leads"

    ],

    sales: [
      "leads",
      "users",
      "offline-billing",

    ],

    inventory: [
      "collections",
      "lowStock"
    ],
  };
  // ✅ ADD IT HERE
  if (roleLoading) {
    return <div>Loading Admin Panel...</div>;
  }
  return (

    <div className="admin-page">

      <h1>Admin Dashboard</h1>
      <div className="admin-tabs">

        {ROLE_PERMISSIONS[currentUserRole]?.includes("collections") && (
          <button
            className={activeTab === "collections" ? "active" : ""}
            onClick={() => setActiveTab("collections")}
          >
            Collections
          </button>
        )}

        {ROLE_PERMISSIONS[currentUserRole]?.includes("orders") && (
          <button
            className={activeTab === "orders" ? "active" : ""}
            onClick={() => setActiveTab("orders")}
          >
            Orders
          </button>
        )}

        {ROLE_PERMISSIONS[currentUserRole]?.includes("dailyorders") && (
             <button
            className="admin-menu-item"
            onClick={() => (window.location.href = "/admin/daily-orders")}
          >
            Daily Order Report
          </button>
        )}

  {ROLE_PERMISSIONS[currentUserRole]?.includes("lowStock") && (
             <button
            className="admin-menu-item"
            onClick={() => (window.location.href = "/admin/productsale/view")}
          >
            Stock Summary
          </button>
        )}

        
         {ROLE_PERMISSIONS[currentUserRole]?.includes("Storestock") && (
             <button
            className="admin-menu-item"
            onClick={() => (window.location.href = "/admin/stockcheck")}
          >
            Stock Summary
          </button>
        )}
        {ROLE_PERMISSIONS[currentUserRole]?.includes("reports") && (
          <button
            className="admin-menu-item"
            onClick={() => (window.location.href = "/inventory/stock")}
          >
            Reports
          </button>
        )}

        {ROLE_PERMISSIONS[currentUserRole]?.includes("users") && (
          <button
            className={activeTab === "users" ? "active" : ""}
            onClick={() => setActiveTab("users")}
          >
            User Management
          </button>
        )}

        {ROLE_PERMISSIONS[currentUserRole]?.includes("offline-billing") && (
          <button
            className={`admin-menu-item ${activeTab === "offline-billing" ? "active" : ""}`}
            onClick={() => setActiveTab("offline-billing")}
          >
            Offline Billing
          </button>
        )}

        {ROLE_PERMISSIONS[currentUserRole]?.includes("coupons") && (
          <button
            className="admin-menu-item"
            onClick={() => (window.location.href = "/admin/coupons")}
          >
            Coupons
          </button>
        )}

        {ROLE_PERMISSIONS[currentUserRole]?.includes("editOrders") && (
          <button
            className="admin-menu-item"
            onClick={() => (window.location.href = "/admin/orders/edit")}
          >
            Edit Orders
          </button>
        )}
        {ROLE_PERMISSIONS[currentUserRole]?.includes("leads") && (
          <button
            className="admin-menu-item"
            onClick={() => (window.location.href = "/admin/leads")}
          >
            leads
          </button>
        )}
         {ROLE_PERMISSIONS[currentUserRole]?.includes("barcode") && (
          <button
            className="admin-menu-item"
            onClick={() => (window.location.href = "/admin/barcode-printing")}
          >
            Barcode Print
          </button>
        )}
        
        {ROLE_PERMISSIONS[currentUserRole]?.includes("custombill") && (
          <button
            className="admin-menu-item"
            onClick={() => (window.location.href = "/custombill")}
          >
            Cuustom Bill
          </button>
        )}
         {ROLE_PERMISSIONS[currentUserRole]?.includes("adminsellers") && (
          <button
            className="admin-menu-item"
            onClick={() => (window.location.href = "/admin/sellers")}
          >
            Sellers
          </button>
        )}
          {ROLE_PERMISSIONS[currentUserRole]?.includes("storeorders") && (
          <button
            className="admin-menu-item"
            onClick={() => (window.location.href = "/admin/store-orders")}
          >
            Store Orders
          </button>
        )}
          {ROLE_PERMISSIONS[currentUserRole]?.includes("sellerprofit") && (
          <button
            className="admin-menu-item"
            onClick={() => (window.location.href = "/admin/seller-profits")}
          >
            Seller Profit
          </button>
        )}


      </div>


      <div className="tab-content">
        {/* --- Collections, Subcollections, and Products Tabs --- */}
        {activeTab === 'collections' &&
          ROLE_PERMISSIONS[currentUserRole]?.includes("collections") && (
            <div className="collection-management-container">
              <div className="sub-tabs">
                <button
                  className={activeSubTab === 'collections' ? 'active' : ''}
                  onClick={() => setActiveSubTab('collections')}
                >
                  Collections
                </button>
                <button
                  className={activeSubTab === 'subcollections' ? 'active' : ''}
                  onClick={() => setActiveSubTab('subcollections')}
                >
                  Subcollections
                </button>
                <button
                  className={activeSubTab === 'products' ? 'active' : ''}
                  onClick={() => setActiveSubTab('products')}
                >
                  Products
                </button>
                {/* <button
                  onClick={handleMoveOutOfStockToTrash}
                  disabled={trashRunning}
                  style={{
                    background: trashRunning ? "#9ca3af" : "#f97316",
                    color: "#fff",
                    padding: "10px 16px",
                    borderRadius: "8px",
                    border: "none",
                    fontWeight: "700",
                    cursor: trashRunning ? "not-allowed" : "pointer",
                    marginTop: "12px",
                  }}
                >
                  {trashRunning ? "Moving to Trash…" : "🗑 Move Out-of-Stock to Trash"}
                </button> */}

                {trashRunning && (
                  <div style={{ marginTop: "10px", maxWidth: "420px" }}>
                    <div
                      style={{
                        height: "8px",
                        background: "#e5e7eb",
                        borderRadius: "999px",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${trashProgress}%`,
                          height: "100%",
                          background: "linear-gradient(90deg, #f97316, #ef4444)",
                          transition: "width 200ms ease",
                        }}
                      />
                    </div>
                    <div style={{ fontSize: "13px", marginTop: "6px", color: "#555" }}>
                      {trashProgress}% completed
                    </div>
                  </div>
                )}

              </div>

              {/* --- Collections Sub-tab Content --- */}
              {activeSubTab === 'collections' && (
                <div className="forms-container">
                  <div className="admin-section">
                    <h2>Main Collections</h2>
                    <form onSubmit={editingMainCollection ? handleUpdateMainCollection : handleAddMainCollection} className="add-collection-form">
                      <h3>{editingMainCollection ? 'Edit' : 'Add'} Main Collection</h3>
                      <div className="form-group">
                        <label>Name:</label>
                        <input type="text" value={mainCollectionName} onChange={(e) => setMainCollectionName(e.target.value)} placeholder="Main Collection Name" required />
                      </div>
                      <div className="form-group">
                        <label>Image:</label>
                        <input type="file" onChange={(e) => handleImageChange(e, setMainCollectionImageFile)} required={!editingMainCollection} />
                      </div>
                      <div className="form-group">
                        <label>Additional Images:</label>
                        <input
                          type="file"
                          multiple
                          accept="image/*"
                          onChange={handleMainCollectionAdditionalImagesChange}
                        />
                      </div>

                      <div className="form-group">
                        <label>Show Number:</label>
                        <input type="number" value={mainCollectionShowNumber} onChange={(e) => setMainCollectionShowNumber(e.target.value)} placeholder="Order (e.g., 1, 2)" required />
                      </div>
                      <button type="submit" disabled={isMainCollectionUploading}>
                        {isMainCollectionUploading ? 'Processing...' : editingMainCollection ? 'Update Collection' : 'Add Collection'}
                      </button>
                      {editingMainCollection && (
                        <button type="button" onClick={resetMainCollectionForm} className="cancel-button">
                          Cancel Edit
                        </button>
                      )}
                    </form>
                  </div>

                  <div className="admin-section">
                    <div className="current-collections">
                      <h3>Current Main Collections</h3>
                      {isMainCollectionLoading ? (
                        <p>Loading collections...</p>
                      ) : (
                        <div className="collections-grid">
                          {mainCollections.map((item) => (
                            <CollectionCard key={item.id} title={item.title} image={item.image} showNumber={item.showNumber}>
                              <div className="admin-actions">
                                <button onClick={() => startEditMainCollection(item)}>Edit</button>
                                <button onClick={() => handleDeleteMainCollection(item)}>Delete</button>
                              </div>
                            </CollectionCard>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* --- Subcollections Sub-tab Content --- */}
              {activeSubTab === 'subcollections' && (
                <div className="forms-container">
                  <div className="admin-section">
                    <h2>Subcollections</h2>
                    <div className="form-group">
                      <label>Select Main Collection:</label>
                      <select onChange={(e) => setSelectedMainCollectionId(e.target.value)} value={selectedMainCollectionId}>
                        <option value="">-- Select a Collection --</option>
                        {mainCollections.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.title}
                          </option>
                        ))}
                      </select>
                    </div>

                    {selectedMainCollectionId && (
                      <form onSubmit={editingSubcollection ? handleUpdateSubcollection : handleAddSubcollection} className="add-collection-form">
                        <h3>{editingSubcollection ? 'Edit' : 'Add'} Subcollection</h3>
                        <div className="form-group">
                          <label>Name:</label>
                          <input type="text" value={subcollectionName} onChange={(e) => setSubcollectionName(e.target.value)} placeholder="Subcollection Name" required />
                        </div>
                        <div className="form-group">
                          <label>Code:</label>
                          <textarea value={subcollectionDescription} onChange={(e) => setSubcollectionDescription(e.target.value)} placeholder="Subcollection productcode"></textarea>
                        </div>
                        <div className="form-group">
                          <label>Image:</label>
                          <input type="file" onChange={(e) => handleImageChange(e, setSubcollectionImageFile)} required={!editingSubcollection} />
                        </div>
                        <div className="form-group">
                          <label>Show Number:</label>
                          <input type="number" value={subcollectionShowNumber} onChange={(e) => setSubcollectionShowNumber(e.target.value)} placeholder="Order (e.g., 1, 2)" required />
                        </div>
                        <div className="form-group">
                          <label>Purchase Rate:</label>
                          <input type="number" step="0.01" value={subcollectionPurchaseRate} onChange={(e) => setSubcollectionPurchaseRate(e.target.value)} placeholder="Purchase Rate (e.g., 0.50)" required />
                        </div>
                        <div className="tiered-pricing-container1">
                          {PRICING_KEYS.map(pricingKey => (
                            <div key={pricingKey} className="pricing-section">
                              <h4>{pricingKey.toUpperCase()} Pricing</h4>

                              {(subcollectionTieredPricing[pricingKey] || []).map((tier, index) => (
                                <div key={index} className="price-tier">
                                  <input
                                    type="number"
                                    placeholder="Min Qty"
                                    value={tier.min_quantity}
                                    onChange={(e) =>
                                      handleTierChange(pricingKey, index, 'min_quantity', e.target.value)
                                    }
                                    required
                                  />

                                  <input
                                    type="number"
                                    placeholder="Max Qty"
                                    value={tier.max_quantity}
                                    onChange={(e) =>
                                      handleTierChange(pricingKey, index, 'max_quantity', e.target.value)
                                    }
                                    required
                                  />

                                  <input
                                    type="number"
                                    step="0.01"
                                    placeholder="Price"
                                    value={tier.price}
                                    onChange={(e) =>
                                      handleTierChange(pricingKey, index, 'price', e.target.value)
                                    }
                                    required
                                  />

                                  <button
                                    type="button"
                                    onClick={() => handleRemoveTier(pricingKey, index)}
                                    className="remove-tier-button"
                                  >
                                    &times;
                                  </button>
                                </div>
                              ))}

                              <button
                                type="button"
                                onClick={() => handleAddTier(pricingKey)}
                                className="add-tier-button"
                              >
                                Add {pricingKey} Tier
                              </button>
                            </div>
                          ))}
                        </div>

                        <button type="submit" disabled={isSubcollectionUploading}>
                          {isSubcollectionUploading ? 'Processing...' : editingSubcollection ? 'Update Subcollection' : 'Add Subcollection'}
                        </button>
                        {editingSubcollection && (
                          <button type="button" onClick={resetSubcollectionForm} className="cancel-button">
                            Cancel Edit
                          </button>
                        )}
                      </form>
                    )}
                  </div>

                  <div className="admin-section">
                    <h3>Current Subcollections</h3>
                    {selectedMainCollectionId ? (
                      isSubcollectionLoading ? (
                        <p>Loading subcollections...</p>
                      ) : (
                        <div className="collections-grid">
                          {subcollections.map((item) => (
                            <CollectionCard key={item.id} title={item.name} description={item.description} image={item.image} tieredPricing={item.tieredPricing}>
                              <div className="admin-actions">
                                <button onClick={() => startEditSubcollection(item)}>Edit</button>
                                <button onClick={() => handleDeleteSubcollection(item.id, item.image)}>Delete</button>
                              </div>
                            </CollectionCard>
                          ))}
                        </div>
                      )
                    ) : (
                      <p className="select-prompt">Please select a main collection to view its subcollections.</p>
                    )}
                  </div>
                </div>
              )}

              {/* --- Products Sub-tab Content --- */}
              {activeSubTab === 'products' && (
                <div className="forms-container">
                  <div className="admin-section">
                    <h2>Products</h2>
                    <div className="form-group">
                      <label>Select Main Collection:</label>
                      <select onChange={(e) => setSelectedMainCollectionId(e.target.value)} value={selectedMainCollectionId}>
                        <option value="">-- Select a Collection --</option>
                        {mainCollections.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.title}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="admin-actions" style={{ margin: '16px 0', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      <button type="button" onClick={() => setProductEntryMode('quick')} className={productEntryMode === 'quick' ? 'active' : ''}>
                        + Add Product (Auto-create Subcollection)
                      </button>
                      <button type="button" onClick={() => setProductEntryMode('manage')} className={productEntryMode === 'manage' ? 'active' : ''}>
                        Manage Existing Products
                      </button>
                      <button type="button" onClick={() => setProductEntryMode('import')} className={productEntryMode === 'import' ? 'active' : ''}>
                        Import Products from CSV
                      </button>
                    </div>

                    {productEntryMode === 'quick' && (
                      <form onSubmit={handleQuickAddProduct} className="add-collection-form quick-add-product-form">
                        <h3>Add One Product</h3>
                        <p>The product name will also be used as its subcollection name. Enter one retail price for now.</p>
                        <div className="form-group">
                          <label>Product Image:</label>
                          <input type="file" accept="image/*" onChange={(e) => {
                            const file = e.target.files?.[0] || null;
                            setQuickProductImage(file);
                            setQuickProductImagePreview(file ? URL.createObjectURL(file) : '');
                          }} required />
                          {quickProductImagePreview && <img src={quickProductImagePreview} alt="Product preview" className="product-preview-image" />}
                        </div>
                        <div className="form-group">
                          <label>Product Name:</label>
                          <input value={quickProductName} onChange={(e) => setQuickProductName(e.target.value)} required />
                        </div>
                        <div className="form-group">
                          <label>Product Code:</label>
                          <input value={quickProductCode} onChange={(e) => setQuickProductCode(e.target.value)} required />
                        </div>
                        <div className="form-group">
                          <label>Stock Quantity:</label>
                          <input type="number" min="0" step="1" value={quickProductQuantity} onChange={(e) => setQuickProductQuantity(e.target.value)} required />
                        </div>
                        <div className="form-group">
                          <label>Purchase Rate:</label>
                          <input type="number" min="0" step="0.01" value={quickProductPurchaseRate} onChange={(e) => setQuickProductPurchaseRate(e.target.value)} required />
                        </div>
                        <div className="quick-retail-price-card">
                          <h4>Retail Price</h4>
                          <label htmlFor="quick-product-retail-price">Price per unit (₹)</label>
                          <input
                            id="quick-product-retail-price"
                            type="number"
                            min="0"
                            step="0.01"
                            value={quickProductRetailPrice}
                            onChange={(e) => setQuickProductRetailPrice(e.target.value)}
                            placeholder="Enter retail price"
                            required
                          />
                          <small>One price for now. It will be used across configured pricing roles until separate prices are needed.</small>
                        </div>
                        <div className="form-group">
                          <label>GST Rate (%):</label>
                          <input type="number" min="0" step="0.01" value={quickProductGstRate} onChange={(e) => setQuickProductGstRate(e.target.value)} placeholder="e.g. 5, 12, 18" />
                        </div>
                        <div className="form-group">
                          <label>GST Type:</label>
                          <select value={quickProductGstType} onChange={(e) => setQuickProductGstType(e.target.value)}>
                            <option value="exclusive">Exclusive</option>
                            <option value="inclusive">Inclusive</option>
                          </select>
                        </div>
                        <div style={{ margin: '20px 0' }}>
                          <label style={{ display: 'block', fontWeight: 'bold', marginBottom: 10 }}>Upload Product To *</label>
                          <div style={{ display: 'flex', gap: 25, alignItems: 'center', flexWrap: 'wrap' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <input type="radio" name="quickProductDestination" value="products" checked={productDestination === 'products'} onChange={(e) => setProductDestination(e.target.value)} /> Website
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <input type="radio" name="quickProductDestination" value="appProducts" checked={productDestination === 'appProducts'} onChange={(e) => setProductDestination(e.target.value)} /> Mobile App
                            </label>
                          </div>
                        </div>
                        <button type="submit" disabled={isProductUploading} className="submit-all-button">
                          {isProductUploading ? 'Saving Product...' : 'Save Product'}
                        </button>
                      </form>
                    )}

                    {productEntryMode === 'import' && (
                      <form onSubmit={handleImportProductsCsv} className="add-collection-form product-csv-import-form">
                        <h3>Bulk Import Products</h3>
                        <p>Select the main collection and upload your CSV. Each CSV row automatically creates its own subcollection (named after the product) and a product document inside it. Retail price, purchase price, GST and stock are saved in both documents.</p>

                        <div className="form-group">
                          <label htmlFor="product-csv-import-input">Products CSV File</label>
                          <input id="product-csv-import-input" type="file" accept=".csv,text/csv" onChange={handleProductImportFileChange} required />
                          <small>Expected columns include: name, sale_price, purchase_price, gst_rate, gst_type, current_stock, min_stock_level, track_inventory and status. For names like 0054_effete_choco_magic, product code is 0054 and product name is Effete Choco Magic. Images are not present in this CSV, so imported products will have an empty image until you add one.</small>
                        </div>

                        <div className="product-import-destination">
                          <label>Save products to *</label>
                          <label className="product-import-radio"><input type="radio" name="csvProductDestination" value="products" checked={productDestination === 'products'} onChange={(e) => setProductDestination(e.target.value)} required /> Website products</label>
                          <label className="product-import-radio"><input type="radio" name="csvProductDestination" value="appProducts" checked={productDestination === 'appProducts'} onChange={(e) => setProductDestination(e.target.value)} required /> Mobile app products</label>
                        </div>

                        {productImportError && <div className="product-import-error" role="alert">{productImportError}</div>}
                        {productImportFile && !productImportError && (
                          <div className="product-import-preview" role="status">
                            <span className="product-import-preview-icon">✓</span>
                            <div><strong>{productImportFile.name}</strong><p>{productImportRows.length} product row(s) ready to import.</p></div>
                          </div>
                        )}
                        <div className="product-import-note"><strong>Duplicate protection:</strong> products with an existing matching product code, or duplicate codes in this CSV, will be skipped. Existing subcollection-wide tiered pricing will not be overwritten because each imported product can have a different retail price.</div>
                        <button type="submit" className="submit-all-button" disabled={isProductImporting || !productImportRows.length || !selectedMainCollectionId || !productDestination}>
                          {isProductImporting ? 'Importing Products…' : `Import ${productImportRows.length || ''} Products`}
                        </button>
                      </form>
                    )}

                    {productEntryMode === 'manage' && <>
                    {selectedSubcollectionId && (
                      <div className="admin-product-edit-shell">

                        <h3>Add/Edit Products</h3>

                        {isCropping ? (
                          // This block shows the cropper
                          <div className="cropper-container">
                            <ReactCrop
                              crop={crop}
                              onChange={c => setCrop(c)}
                              onComplete={c => setCompletedCrop(c)}
                            >
                              <img src={imageToCrop} ref={imgRef} alt="Product" />
                            </ReactCrop>
                            <div className="cropper-buttons">
                              <button type="button" onClick={getCroppedImage}>Crop Image</button>
                              <button type="button" onClick={() => setIsCropping(false)}>Cancel</button>
                            </div>
                          </div>
                        ) : (
                          // This block shows either the product form or the file input
                          <>
                            {showProductForm ? (
                              <form onSubmit={editingProduct ? handleUpdateProduct : (currentImageIndex < newProducts.length ? handleNextProduct : handleAddAllProducts)} className="admin-product-edit-form">
                                {editingProduct ? (
                                  <>
                                    <div className="product-form-item">
                                      <img src={editingProduct.image} alt="Product Preview" className="product-preview-image" />
                                      <button type="button" onClick={() => startCropping(editingProduct.image)} className="crop-button">
                                        <span role="img" aria-label="crop icon">✂️</span> Crop
                                      </button>
                                      <div className="product-details-inputs">
                                        <div className="form-group">
                                          <label>Product Name:</label>
                                          <input type="text" value={productName} onChange={(e) => setProductName(e.target.value)} required />
                                        </div>
                                        <div className="form-group">
                                          <label>Product Code:</label>
                                          <input type="text" value={productCode} onChange={(e) => setProductCode(e.target.value)} required />
                                        </div>

                                        {/* Conditional Rendering: Show Quantity OR Variations (FIXED) */}
                                        {productVariations.length === 0 ? (
                                          // Show the single Quantity input if no variations are added
                                          <div className="form-group">
                                            <label>Quantity:</label>
                                            <input type="number" value={productQuantity} onChange={(e) => setProductQuantity(e.target.value)} onWheel={(e) => e.preventDefault()} required />
                                          </div>
                                        ) : (
                                          // Show the variations list if variations are present
                                          <div className="variation-input-container">
                                            <h4>Current Variations</h4>
                                            <ul className="variations-list">
                                              {productVariations.map((v, index) => (
                                                <li key={index} className="variation-item">
                                                  <span>{v.color}, {v.size}, Qty: {v.quantity}</span>
                                                  <button type="button" onClick={() => handleRemoveVariation(index)} className="remove-variation-btn">
                                                    &times;
                                                  </button>
                                                </li>
                                              ))}
                                            </ul>
                                          </div>
                                        )}

                                        {/* NEW: Always show the variation input fields for adding more variations (same as bulk upload) */}
                                        <div className="variation-input">
                                          <input
                                            type="text"
                                            name="color"
                                            value={newVariation.color}
                                            onChange={handleNewVariationChange}
                                            placeholder="Color (e.g., Red)"
                                          />
                                          <input
                                            type="text"
                                            name="size"
                                            value={newVariation.size}
                                            onChange={handleNewVariationChange}
                                            placeholder="Size (e.g., L)"
                                          />
                                          <input
                                            type="number"
                                            name="quantity"
                                            value={newVariation.quantity}
                                            onChange={handleNewVariationChange}
                                            placeholder="Quantity"
                                          />
                                          <button type="button" onClick={handleAddVariation} className="add-variation-btn">
                                            Add Variation
                                          </button>
                                        </div>

                                        {/* The Upload Additional Product Photos section remains here */}
                                        <div className="form-group">
                                          <label>Upload Additional Product Photos:</label>
                                          <input
                                            type="file"
                                            onChange={handleAdditionalImageChange}
                                            multiple
                                            accept="image/*"
                                          />
                                        </div>
                                        <div className="tiered-pricing-container1">
                                            <h4>Product Pricing</h4>
                                            <p>Purchase, retail and GST details are saved to the product. For auto-created one-product subcollections, the same details are synced to its subcollection.</p>
                                            <div className="form-group">
                                              <label>Purchase Rate:</label>
                                              <input
                                                type="number"
                                                min="0"
                                                step="0.01"
                                                value={editProductPurchaseRate}
                                                onChange={(e) => setEditProductPurchaseRate(e.target.value)}
                                                required
                                              />
                                            </div>
                                            <div className="form-group">
                                              <label>Retail Price (₹):</label>
                                              <input type="number" min="0" step="0.01" value={editProductRetailPrice} onChange={(e) => setEditProductRetailPrice(e.target.value)} required />
                                            </div>
                                            <div className="form-group">
                                              <label>GST Rate (%):</label>
                                              <input type="number" min="0" step="0.01" value={editProductGstRate} onChange={(e) => setEditProductGstRate(e.target.value)} />
                                            </div>
                                            <div className="form-group">
                                              <label>GST Type:</label>
                                              <select value={editProductGstType} onChange={(e) => setEditProductGstType(e.target.value)}>
                                                <option value="exclusive">Exclusive</option><option value="inclusive">Inclusive</option>
                                              </select>
                                            </div>
                                            {selectedSubcollectionData?.autoCreatedForProduct && PRICING_KEYS.map((pricingKey) => (
                                              <div className="form-group" key={pricingKey}>
                                                <label>{pricingKey.toUpperCase()} Price (quantity 1+):</label>
                                                <input
                                                  type="number"
                                                  min="0"
                                                  step="0.01"
                                                  value={editProductPrices[pricingKey] ?? ''}
                                                  onChange={(e) => setEditProductPrices(prev => ({ ...prev, [pricingKey]: e.target.value }))}
                                                  required
                                                />
                                              </div>
                                            ))}
                                          </div>
                                          <section className="deodap-editor-panel">
                                            <div className="deodap-editor-heading">
                                              <span className="deodap-editor-eyebrow">DEODAP CATALOG</span>
                                              <h4>Product content & pricing</h4>
                                              <p>Update scraped storefront details without removing your existing inventory, GST or tiered pricing.</p>
                                            </div>
                                            <div className="deodap-json-loader">
                                              <label htmlFor="deodap-product-json">Import one scraped product JSON</label>
                                              <textarea id="deodap-product-json" rows="5" value={deodapRawJson} onChange={e => setDeodapRawJson(e.target.value)} placeholder='Paste the complete product JSON exported by your scraper…' />
                                              <div className="deodap-json-loader-footer"><span>Loads title, price, SKU, tags, descriptions, variants, image metadata and other scraper fields.</span><button type="button" onClick={loadDeoDapScrapedJson} disabled={!deodapRawJson.trim()}>Load JSON into fields</button></div>
                                            </div>
                                            <div className="deodap-editor-grid">
                                              <div className="form-group"><label>SKU</label><input value={deodapFields.sku} onChange={e => updateDeodapField('sku', e.target.value)} placeholder="e.g. 0510_travelling_pillow" /></div>
                                              <div className="form-group"><label>Compare-at price (₹)</label><input type="number" min="0" step="0.01" value={deodapFields.compareAtPrice} onChange={e => updateDeodapField('compareAtPrice', e.target.value)} placeholder="MRP / original price" /></div>
                                              <div className="form-group"><label>Discount (%)</label><input type="number" min="0" max="100" step="0.01" value={deodapFields.discountPercentage} onChange={e => updateDeodapField('discountPercentage', e.target.value)} placeholder="Auto-calculated if blank" /></div>
                                              <div className="form-group"><label>Vendor / brand</label><input value={deodapFields.vendor} onChange={e => updateDeodapField('vendor', e.target.value)} placeholder="DeoDap" /></div>
                                              <div className="form-group"><label>Product type</label><input value={deodapFields.productType} onChange={e => updateDeodapField('productType', e.target.value)} placeholder="Category / type" /></div>
                                              <div className="form-group"><label>Tags (comma-separated)</label><input value={deodapFields.tags} onChange={e => updateDeodapField('tags', e.target.value)} placeholder="travel, accessories, bestseller" /></div>
                                              <div className="form-group"><label>Source</label><input value={deodapFields.source} onChange={e => updateDeodapField('source', e.target.value)} placeholder="deodap.in" /></div>
                                              <div className="form-group"><label>Product handle</label><input value={deodapFields.handle} onChange={e => updateDeodapField('handle', e.target.value)} placeholder="product-url-handle" /></div>
                                              <div className="form-group deodap-wide"><label>Source product URL</label><input type="url" value={deodapFields.productUrl} onChange={e => updateDeodapField('productUrl', e.target.value)} placeholder="https://..." /></div>
                                              <div className="form-group"><label>Currency</label><input value={deodapFields.currency} onChange={e => updateDeodapField('currency', e.target.value)} placeholder="INR" /></div>
                                              <div className="form-group"><label>Origin</label><input value={deodapFields.origin} onChange={e => updateDeodapField('origin', e.target.value)} placeholder="Source product origin" /></div>
                                              <div className="form-group deodap-wide"><label>Scraped at</label><input value={deodapFields.scrapedAt} onChange={e => updateDeodapField('scrapedAt', e.target.value)} placeholder="ISO date/time from scraper" /></div>
                                              <div className="form-group deodap-wide"><label>Plain-text description</label><textarea rows="4" value={deodapFields.descriptionText} onChange={e => updateDeodapField('descriptionText', e.target.value)} placeholder="Readable product description" /></div>
                                              <div className="form-group deodap-wide"><label>HTML description</label><textarea rows="6" value={deodapFields.descriptionHtml} onChange={e => updateDeodapField('descriptionHtml', e.target.value)} placeholder="<p>Product description...</p>" /></div>
                                              <div className="form-group deodap-wide"><label>Key features (one per line)</label><textarea rows="4" value={deodapFields.keyFeatures} onChange={e => updateDeodapField('keyFeatures', e.target.value)} placeholder="Lightweight design&#10;Easy to carry&#10;Durable material" /></div>
                                              <div className="form-group deodap-wide"><label>FAQs (JSON array)</label><textarea rows="6" value={deodapFields.faqs} onChange={e => updateDeodapField('faqs', e.target.value)} placeholder={'[{"question":"What is included?","answer":"One product."}]'} /><small>Keep this as a valid JSON array of question/answer objects.</small></div>
                                              <label className="deodap-availability"><input type="checkbox" checked={deodapFields.available} onChange={e => updateDeodapField('available', e.target.checked)} /> Available for sale</label>
                                            </div>
                                          </section>
                                      </div>
                                    </div>
                                  </>
                                ) : (
                                  // ... bulk upload JSX remains here
                                  <>
                                    {newProducts.length > 0 && currentImageIndex < newProducts.length ? (
                                      <>
                                        <div className="product-form-item">
                                          <img src={newProducts[currentImageIndex].previewUrl} alt="Product Preview" className="product-preview-image" />
                                          <button type="button" onClick={() => startCropping(newProducts[currentImageIndex].previewUrl)} className="crop-button">
                                            <span role="img" aria-label="crop icon">✂️</span> Crop
                                          </button>
                                          <button type="button" onClick={() => handleDeleteNewImage(currentImageIndex)} className="delete-button">
                                            <span role="img" aria-label="delete icon">🗑️</span> Delete
                                          </button>
                                          <div className="product-details-inputs">
                                            {/* Product Name and Code remain here */}
                                            <div className="form-group">
                                              <label>Product Name:</label>
                                              <input type="text" value={productName} onChange={(e) => setProductName(e.target.value)} required />
                                            </div>
                                            <div className="form-group">
                                              <label>Product Code:</label>
                                              <input type="text" value={productCode} onChange={(e) => setProductCode(e.target.value)} required />
                                            </div>

                                            {/* Conditional Rendering: Show Quantity OR Variations */}
                                            {productVariations.length === 0 ? (
                                              // Show the single Quantity input if no variations are added
                                              <div className="form-group">
                                                <label>Quantity:</label>
                                                <input type="number" value={productQuantity} onChange={(e) => setProductQuantity(e.target.value)} required />
                                              </div>
                                            ) : (
                                              // Show the variations list if variations are present
                                              <div className="variation-input-container">
                                                <h4>Add More Variations</h4>
                                                <ul className="variations-list">
                                                  {productVariations.map((v, index) => (
                                                    <li key={index} className="variation-item">
                                                      <span>{v.color}, {v.size}, Qty: {v.quantity}</span>
                                                      <button type="button" onClick={() => handleRemoveVariation(index)} className="remove-variation-btn">
                                                        &times;
                                                      </button>
                                                    </li>
                                                  ))}
                                                </ul>
                                              </div>
                                            )}

                                            {/* NEW: Always show the variation input fields regardless of whether variations exist or not */}
                                            <div className="variation-input">
                                              <input
                                                type="text"
                                                name="color"
                                                value={newVariation.color}
                                                onChange={handleNewVariationChange}
                                                placeholder="Color (e.g., Red)"
                                              />
                                              <input
                                                type="text"
                                                name="size"
                                                value={newVariation.size}
                                                onChange={handleNewVariationChange}
                                                placeholder="Size (e.g., L)"
                                              />
                                              <input
                                                type="number"
                                                name="quantity"
                                                value={newVariation.quantity}
                                                onChange={handleNewVariationChange}
                                                placeholder="Quantity"
                                              />
                                              <button type="button" onClick={handleAddVariation} className="add-variation-btn">
                                                Add Variation
                                              </button>
                                            </div>

                                            {/* The Upload Additional Product Photos section remains here */}
                                            <div className="form-group">
                                              <label>Upload Additional Product Photos:</label>
                                              <input
                                                type="file"
                                                onChange={handleAdditionalImageChange}
                                                multiple
                                                accept="image/*"
                                              />
                                            </div>
                                          </div>
                                        </div>
                                        <div className="file-info">
                                          Image {currentImageIndex + 1} of {newProducts.length}
                                        </div>

                                      </>
                                    ) : (
                                      <p>All product details filled. Click 'Add All Products' to save.</p>
                                    )}
                                  </>
                                )}
                               <div
  style={{
    marginTop: "20px",
    marginBottom: "20px",
  }}
>
  <label
    style={{
      display: "block",
      fontWeight: "bold",
      marginBottom: "10px",
    }}
  >
    Upload Product To <span style={{ color: "red" }}>*</span>
  </label>

  <div
    style={{
      display: "flex",
      gap: "25px",
      alignItems: "center",
    }}
  >
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        cursor: "pointer",
      }}
    >
      <input
        type="radio"
        name="productDestination"
        value="products"
        checked={productDestination === "products"}
        onChange={(e) => setProductDestination(e.target.value)}
      />
      🌐 Website
    </label>

    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        cursor: "pointer",
      }}
    >
      <input
        type="radio"
        name="productDestination"
        value="appProducts"
        checked={productDestination === "appProducts"}
        onChange={(e) => setProductDestination(e.target.value)}
      />
      📱 Mobile App
    </label>
  </div>
</div>
                                <button type="submit" disabled={isProductUploading} className="submit-all-button">
                                  {isProductUploading ? 'Uploading...' : editingProduct ? 'Update Product' : currentImageIndex < newProducts.length - 1 ? 'Next' : 'Add All Products'}
                                </button>
                                <button type="button" onClick={resetProductForm} className="cancel-button">
                                  Cancel
                                </button>
                              </form>
                            ) : (
                              <div className="form-group">
                                <label>Upload Product Photos:</label>
                                <input type="file" onChange={handleProductImageChange} multiple />
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                    </>}
                  </div>
                  {productEntryMode === 'manage' && (
                  <>
                  <div className="admin-section deodap-folder-sync-panel">
                    <div className="deodap-folder-sync-heading">
                      <div>
                        <span className="deodap-eyebrow">CATALOG MATCHING</span>
                        <h3>Connect DeoDap output folder</h3>
                        <p>Upload the scraper output folder once. Products with a unique matching product code/SKU can be connected together. Manually match the remaining products in their rows; product codes and images are preserved.</p>
                      </div>
                      <label className="deodap-folder-upload-button">
                        <span>{deodapFolderLoading ? 'Reading folder…' : 'Choose output folder'}</span>
                        <input type="file" webkitdirectory="" directory="" multiple accept=".json,application/json" onChange={handleDeoDapFolderUpload} disabled={deodapFolderLoading} />
                      </label>
                    </div>
                    <div className="deodap-folder-sync-stats">
                      <span><strong>{deodapScrapedCatalog.length}</strong> scraped records loaded</span>
                      {deodapFolderName && <span>Folder: <strong>{deodapFolderName}</strong></span>}
                      <span>Product code: <strong>preserved</strong></span>
                      <span>Image URLs: <strong>not imported</strong></span>
                      <span>Tiered pricing: <strong>all roles updated</strong></span>
                      <span><strong>{Object.values(deodapConnectionStatus).filter(item => item.state === 'connected').length}</strong> connected</span>
                      <span><strong>{Object.values(deodapConnectionStatus).filter(item => item.state === 'failed').length}</strong> failed</span>
                    </div>
                    <div className="deodap-bulk-actions">
                      <button type="button" className="deodap-connect-all-button" onClick={handleConnectAllDeoDapMatches} disabled={deodapBulkConnecting || deodapFolderLoading || !deodapScrapedCatalog.length || !allCollectionProducts.length}>
                        {deodapBulkConnecting ? 'Connecting matched products…' : `Connect & update all matched products (${allCollectionProducts.filter(product => { const key = normalizeProductCode(product.productCode); return key && deodapScrapedCatalog.filter(item => normalizeProductCode(getDeoDapRecordCode(item)) === key).length === 1; }).length})`}
                      </button>
                      <span>Unique code/SKU matches connect automatically. Ambiguous and unmatched products are skipped and reported.</span>
                    </div>
                  </div>
                  <div className="admin-section deodap-folder-sync-panel" style={{ marginTop: 16 }}>
                    <div className="deodap-folder-sync-heading">
                      <div>
                        <span className="deodap-eyebrow">BULK PRODUCT IMAGES</span>
                        <h3>Upload compressed images by SKU</h3>
                        <p>Select the scraper output folder. Images are compressed in the browser to WebP (maximum 1000px, quality 72%), uploaded to Firebase Storage, and saved to the matching product record. The first image becomes the main image; all successfully uploaded images are saved in imageUrls.</p>
                      </div>
                      <label className="deodap-folder-upload-button" style={{ opacity: deodapImageUploading ? 0.65 : 1 }}>
                        <span>{deodapImageUploading ? `Compressing & uploading ${deodapImageProgress.current}/${deodapImageProgress.total}` : 'Choose images output folder'}</span>
                        <input
                          type="file"
                          webkitdirectory=""
                          directory=""
                          multiple
                          accept="image/*,.json,application/json"
                          onChange={handleDeodapBulkImagesUpload}
                          disabled={deodapImageUploading}
                        />
                      </label>
                    </div>
                    {deodapImageFolderName && <p style={{ margin: '8px 0' }}>Selected folder: <strong>{deodapImageFolderName}</strong></p>}
                    {deodapImageUploading && (
                      <div style={{ marginTop: 12 }}>
                        <div style={{ height: 8, background: '#e5e7eb', borderRadius: 99, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${deodapImageProgress.total ? Math.min(100, (deodapImageProgress.current / deodapImageProgress.total) * 100) : 0}%`, background: '#16a34a', transition: 'width 180ms ease' }} />
                        </div>
                        <div className="deodap-folder-sync-stats" style={{ marginTop: 8 }}>
                          <span>Current SKU/folder: <strong>{deodapImageProgress.currentSku || 'Preparing…'}</strong></span>
                          <span>Images processed: <strong>{deodapImageProgress.current}/{deodapImageProgress.total}</strong></span>
                          <span>Uploaded: <strong>{deodapImageProgress.uploaded}</strong></span>
                          <span>Products saved: <strong>{deodapImageProgress.matched}</strong></span>
                          <span>Failed: <strong>{deodapImageProgress.failed}</strong></span>
                          <span>Skipped: <strong>{deodapImageProgress.skipped}</strong></span>
                        </div>
                      </div>
                    )}
                    <div className="deodap-folder-sync-stats">
                      <span>Compression: <strong>WebP · 1000px max · 72% quality</strong></span>
                      <span>Images found: <strong>{deodapImageSizeReport.imageCount.toLocaleString()}</strong></span>
                      <span>Original total size: <strong>{formatFileSize(deodapImageSizeReport.originalBytes)}</strong></span>
                      <span>Compressed size so far: <strong>{formatFileSize(deodapImageSizeReport.compressedBytes)}</strong>{deodapImageSizeReport.compressedCount ? ` (${deodapImageSizeReport.compressedCount}/${deodapImageSizeReport.imageCount} processed)` : ' (shown during upload)'}</span>
                      {deodapImageSizeReport.compressedBytes > 0 && <span>Space saved so far: <strong>{formatFileSize(Math.max(0, deodapImageSizeReport.originalBytes - deodapImageSizeReport.compressedBytes))} ({Math.max(0, Math.round((1 - deodapImageSizeReport.compressedBytes / Math.max(1, deodapImageSizeReport.originalBytes)) * 100))}%)</strong></span>}
                      <span>Firebase Storage path: <strong>deodap-product-images/SKU/</strong></span>
                      <span>Unmatched SKUs: <strong>skipped and reported</strong></span>
                    </div>
                  </div>
                  <div className="admin-section">
                    <h3>Current Products</h3>
                    {selectedMainCollectionId ? (
                      isProductLoading ? (
                        <p>Loading products...</p>
                      ) : (
                        <>
                          <div className="search-container">
                            <input
                              type="text"
                              placeholder="Search by name or code..."
                              value={productSearchTerm}
                              onChange={(e) => setProductSearchTerm(e.target.value)}
                              className="search-input"
                            />
                          </div>
                          <div className="product-inventory-summary">
                            <div className="product-summary-card"><span>Products</span><strong>{filteredProducts.length}</strong></div>
                            <div className="product-summary-card"><span>Total stock units</span><strong>{filteredProducts.reduce((sum, product) => sum + (Number(product.quantity ?? product.current_stock) || 0), 0).toLocaleString('en-IN')}</strong></div>
                            <div className="product-summary-card"><span>Purchase stock value</span><strong>₹{filteredProducts.reduce((sum, product) => sum + (Number(product.purchasePrice ?? product.purchaseRate) || 0) * (Number(product.quantity ?? product.current_stock) || 0), 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</strong></div>
                            <div className="product-summary-card"><span>Retail stock value</span><strong>₹{filteredProducts.reduce((sum, product) => sum + (Number(product.retailPrice ?? product.salePrice ?? product.price) || 0) * (Number(product.quantity ?? product.current_stock) || 0), 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</strong></div>
                          </div>
                          <div className="product-details-table-wrap">
                            <table className="product-details-table">
                              <thead><tr><th>Product</th><th>Code</th><th>SKU</th><th>Tags</th><th>Subcollection</th><th>Destination</th><th>Purchase</th><th>Selling price</th><th>Compare-at</th><th>Discount</th><th>Vendor</th><th>Product type</th><th>GST</th><th>Stock</th><th>Purchase stock total</th><th>Retail stock total</th><th>Plain description</th><th>HTML description</th><th>Key features</th><th>FAQs</th><th>Source</th><th>Product URL</th><th>Handle</th><th>Origin</th><th>Currency</th><th>Scraped at</th><th>Scraped variants</th><th>Inventory row</th><th>Available</th><th>Actions</th></tr></thead>
                              <tbody>
                                {filteredProducts.map((product) => {
                                  const stock = Number(product.quantity ?? product.current_stock) || 0;
                                  const retail = Number(product.retailPrice ?? product.salePrice ?? product.price) || 0;
                                  return <tr key={`detail-${product.destination || 'products'}-${product.id}`}>
                                    <td>{product.productName || 'Unnamed product'}</td>
                                    <td>{product.productCode || '—'}</td>
                                    <td>{product.sku || product.inventoryRow?.sku || '—'}</td>
                                    <td title={(Array.isArray(product.tags) ? product.tags : []).join(', ')}>{Array.isArray(product.tags) ? product.tags.join(', ') || '—' : product.tags || '—'}</td>
                                    <td>{product.subcollectionName || '—'}</td>
                                    <td>{product.destination === 'appProducts' ? 'Mobile App' : 'Website'}</td>
                                    <td>₹{(Number(product.purchasePrice ?? product.purchaseRate) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                                    <td>₹{retail.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                                    <td>₹{(Number(product.compareAtPrice) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                                    <td>{Number(product.discountPercentage) || (Number(product.compareAtPrice) > 0 ? Math.max(0, ((Number(product.compareAtPrice) - retail) / Number(product.compareAtPrice)) * 100) : 0).toFixed(2)}%</td>
                                    <td>{product.vendor || '—'}</td>
                                    <td>{product.productType || '—'}</td>
                                    <td>{Number(product.gstRate ?? product.gst_rate) || 0}%</td>
                                    <td>{stock.toLocaleString('en-IN')}</td>
                                    <td>₹{((Number(product.purchasePrice ?? product.purchaseRate) || 0) * stock).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                                    <td>₹{(retail * stock).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                                    <td><details className="product-field-details"><summary>{product.descriptionText ? 'View description' : '—'}</summary><div>{product.descriptionText || 'No plain-text description saved.'}</div></details></td>
                                    <td><details className="product-field-details"><summary>{product.descriptionHtml ? 'View HTML' : '—'}</summary><pre>{product.descriptionHtml || 'No HTML description saved.'}</pre></details></td>
                                    <td><details className="product-field-details"><summary>{product.keyFeatures?.length ? `${product.keyFeatures.length} feature(s)` : '—'}</summary><pre>{Array.isArray(product.keyFeatures) ? product.keyFeatures.join('\n') : product.keyFeatures || ''}</pre></details></td>
                                    <td><details className="product-field-details"><summary>{product.faqs?.length ? `${product.faqs.length} FAQ(s)` : '—'}</summary><pre>{JSON.stringify(product.faqs || [], null, 2)}</pre></details></td>
                                    <td>{product.source || '—'}</td>
                                    <td>{product.productUrl ? <a href={product.productUrl} target="_blank" rel="noreferrer">Open source</a> : '—'}</td>
                                    <td>{product.handle || '—'}</td>
                                    <td>{product.origin || '—'}</td>
                                    <td>{product.currency || 'INR'}</td>
                                    <td>{product.scrapedAt || '—'}</td>
                                    <td><details className="product-field-details"><summary>{product.variants?.length ? `${product.variants.length} variant(s)` : '—'}</summary><pre>{JSON.stringify(product.variants || [], null, 2)}</pre></details></td>
                                    <td><details className="product-field-details"><summary>{product.inventoryRow ? 'View row' : '—'}</summary><pre>{JSON.stringify(product.inventoryRow || {}, null, 2)}</pre></details></td>
                                    <td><span className={`deodap-status ${product.available === false ? 'is-unavailable' : 'is-available'}`}>{product.available === false ? 'Unavailable' : 'Available'}</span></td>
                                    <td className="deodap-row-actions">
                                      {deodapScrapedCatalog.length > 0 && (() => {
                                        const rowKey = `${product.destination || 'products'}:${product.id}`;
                                        const search = deodapMatchSearch[rowKey] || '';
                                        const selectedKey = deodapSelectedMatch[rowKey] || '';
                                        const matches = deodapScrapedCatalog.filter(item => `${item.__title} ${item.__sku} ${item.handle || ''} ${item.inventory_name || ''}`.toLowerCase().includes(search.toLowerCase())).slice(0, 8);
                                        const productCodeKey = normalizeProductCode(product.productCode);
                                        const codeMatches = productCodeKey
                                          ? deodapScrapedCatalog.filter(item => normalizeProductCode(getDeoDapRecordCode(item)) === productCodeKey)
                                          : [];
                                        const automaticRecord = codeMatches.length === 1 ? codeMatches[0] : null;
                                        const selectedRecord = deodapScrapedCatalog.find(item => item.__catalogKey === selectedKey) || automaticRecord;
                                        const connectionStatus = deodapConnectionStatus[rowKey];
                                        return <div className="deodap-row-matcher">
                                          {connectionStatus && <small className={`deodap-connection-status is-${connectionStatus.state}`}>{connectionStatus.state === 'connected' ? '✓ Connected' : connectionStatus.state === 'failed' ? `✕ Failed: ${connectionStatus.error || 'see report'}` : '… Connecting'}</small>}
                                          {automaticRecord && !selectedKey && <small className="deodap-auto-match-note">Auto-matched by product code {product.productCode} ↔ SKU {automaticRecord.__sku}. Review, then connect.</small>}
                                          {!automaticRecord && codeMatches.length > 1 && <small className="deodap-auto-match-note deodap-auto-match-warning">Multiple scraper records use code {product.productCode}; choose one manually.</small>}
                                          <input type="search" value={search} onChange={e => { setDeodapMatchSearch(prev => ({ ...prev, [rowKey]: e.target.value })); setDeodapSelectedMatch(prev => ({ ...prev, [rowKey]: '' })); }} placeholder="Search scraped name…" aria-label={`Search scraper products for ${product.productName || product.productCode}`} />
                                          {search && !selectedRecord && <div className="deodap-match-options">{matches.map(item => <button key={item.__catalogKey} type="button" onClick={() => { setDeodapSelectedMatch(prev => ({ ...prev, [rowKey]: item.__catalogKey })); setDeodapMatchSearch(prev => ({ ...prev, [rowKey]: item.__title })); }}><strong>{item.__title}</strong><small>{item.__sku ? `SKU: ${item.__sku} · ` : ''}{item.__price !== '' ? `₹${item.__price}` : 'No price'} · {item.__fileName}</small></button>)}{matches.length === 0 && <span>No matching scraper records</span>}</div>}
                                          {selectedRecord && <div className="deodap-selected-match"><span>Matched: {selectedRecord.__title}</span><button type="button" disabled={deodapConnectingId === rowKey} onClick={() => handleConnectDeoDapRecord(product, selectedRecord)}>{deodapConnectingId === rowKey ? 'Saving…' : 'Connect & update'}</button></div>}
                                        </div>;
                                      })()}
                                      <button type="button" className="manage-product-edit-button" onClick={() => startEditProduct(product)}>Edit</button>
                                    </td>
                                  </tr>;
                                })}
                              </tbody>
                            </table>
                          </div>
                          <div className="collections-grid">
                            {filteredProducts.length > 0 ? (
                              filteredProducts.map((product) => (
                                <ProductCard
                                  key={`${product.subcollectionId || selectedSubcollectionId}-${product.destination || 'products'}-${product.id}`}
                                  product={product} // This passes the entire product object
                                  onEdit={() => startEditProduct(product)}
                                  onDelete={() => handleDeleteProduct(product)}

                                  // 🔥 NEW PROP ADDED 🔥
                                  onToggleHighlight={handleToggleHighlight}
                                />
                              ))
                            ) : (
                              <p>No products found matching your search criteria.</p>
                            )}
                          </div>
                        </>
                      )
                    ) : (
                      <p className="select-prompt">Please select a main collection to view all products and their automatically created subcollections.</p>
                    )}
                  </div>
                  </>
                  )}
                </div>
              )}
            </div>
          )}

        {/* --- Order Management Section --- */}
        {activeTab === 'orders' &&
          ROLE_PERMISSIONS[currentUserRole]?.includes("orders") && (
            <div className="admin-section">
              <h2>Customer Orders</h2>

              {/* Search and Filter Bar */}
              <div className="order-filters">
                <input
                  type="text"
                  placeholder="Search by ID, name, email, or phone"
                  value={orderSearchTerm}
                  onChange={(e) => setOrderSearchTerm(e.target.value)}
                  className="search-input"
                />
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  title="Start Date"
                />
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  title="End Date"
                />
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="status-select"
                >
                <option value="All">All Statuses</option>
<option value="Pending">Pending</option>
<option value="Paymentdone">Payment Done</option>
<option value="Packed">Packed</option>
<option value="Dispatched">Dispatched</option>
<option value="Delivered">Delivered</option>
<option value="Cancelled">Cancelled</option>

                </select>

              </div>

              {isOrderLoading ? (
                <p>Loading orders...</p>
              ) : filteredOrders.length === 0 ? (
                <p>No orders found with the current filters.</p>
              ) : (
                // Now we map over the sortedDateKeys
                sortedDateKeys.length > 0 ? (
                  sortedDateKeys.map(dateKey => (
                    <div key={dateKey} className="order-date-group">
                      <h3>{dateKey}</h3>
                      <ul className="orders-list">
                        {
                          // 👇 FIX: Use optional chaining and nullish coalescing
                          groupedOrdersFromFiltered[dateKey]?.map((order) => (
                            <li
                              key={order.id}
                              onClick={() => setSelectedOrder(order)}
                              className="order-list-item"
                            >
                              <p>Order ID: <strong>{order.id.substring(0, 8)}...</strong></p>
                              <p>Contact: <strong>{order.billingInfo?.phoneNumber || ''}</strong></p>
                              <p>Name: <strong>{order.billingInfo?.fullName || ''}</strong></p>

                              <p>Total: <strong>₹{order.totalAmount.toFixed(2)}</strong></p>
                              <p>Status: <span className={`order-status status-${order.status ? order.status.toLowerCase() : 'pending'}`}>{order.status}</span></p>
                            </li>
                          ))}
                      </ul>
                    </div>
                  ))
                ) : (
                  <p>No orders found with the current filters.</p>
                )
              )}
            </div>
          )}

        {/* Render Order Details Modal */}
        {selectedOrder && (
          <OrderDetailsModal
            order={selectedOrder}
            onClose={() => setSelectedOrder(null)}
            onUpdateStatus={handleUpdateOrderStatus}
            onCancelOrder={handleCancelOrder}
          />
        )}
        {/* --- Low Stock Tab --- */}
        {activeTab === 'lowStock' && (
          <div className="admin-section">
            <h2>Low Stock Alerts</h2>
            <div className="low-stock-header">
              <p>The following products have a quantity less than or equal to {LOW_STOCK_THRESHOLD}.</p>
              <button onClick={handleDownloadLowStockImages} disabled={isDownloading || lowStockProducts.length === 0} className="download-all-btn">
                {isDownloading ? 'Downloading...' : 'Download All Images'}
              </button>
            </div>
            {isLowStockLoading ? (
              <p>Scanning for low stock products...</p>
            ) : lowStockProducts.length === 0 ? (
              <p>No products are currently low in stock.</p>
            ) : (
              <div className="collections-grid">
                {lowStockProducts.map((product) => (
                  <ProductCard key={product.id} productName={product.productName} productCode={product.productCode} quantity={product.quantity} image={product.image} />
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'reports' && (
          <div className="admin-section">
            <h2>Financial Reports</h2>
            {isReportsLoading ? (
              <p>Loading reports...</p>
            ) : (
              <div className="reports-container">

                <div className="report-table-container">
                  <h3>Order Report</h3>
                  <table className="report-table">
                    <thead>
                      <tr>
                        <th>Order ID</th>
                        <th>Date</th>
                        <th>Total Amount</th>
                        <th>Status</th>
                        <th>Customer Email</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orderReports.length > 0 ? (
                        orderReports.map(report => (
                          <tr key={report.id}>
                            <td>{report.id.substring(0, 8)}...</td>
                            <td>{report.createdAt}</td>
                            <td>₹{report.totalAmount?.toFixed(2) || '0.00'}</td>
                            <td><span className={`order-status status-${report.status?.toLowerCase() || 'unknown'}`}>{report.status || 'N/A'}</span></td>
                            <td>{report.userEmail || 'N/A'}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan="5">No order data found.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="report-table-container">
                  <h3>Payment Report</h3>
                  <table className="report-table">
                    <thead>
                      <tr>
                        <th>Order ID</th>
                        <th>Date</th>
                        <th>Total Amount</th>
                        <th>Payment Method</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paymentReports.length > 0 ? (
                        paymentReports.map((report, index) => (
                          <tr key={index}>
                            <td>{report.orderId.substring(0, 8)}...</td>
                            <td>{report.date}</td>
                            <td>₹{report.totalAmount?.toFixed(2) || '0.00'}</td>
                            <td>{report.paymentMethod}</td>
                            <td><span className={`order-status status-${report.status?.toLowerCase() || 'unknown'}`}>{report.status || 'N/A'}</span></td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan="5">No payment data found.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="report-table-container">
                  <h3>Product Report</h3>
                  <table className="report-table">
                    <thead>
                      <tr>
                        <th>Product Code</th>
                        <th>Product Name</th>
                        <th>Quantity in Stock</th>
                        <th>Total Sales</th>
                        <th>Total Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {productReports.length > 0 ? (
                        productReports.map((report, index) => (
                          <tr key={index}>
                            <td>{report.productCode}</td>
                            <td>{report.productName}</td>
                            <td>{report.quantityInStock}</td>
                            <td>{report.totalSales}</td>
                            <td>₹{report.totalRevenue.toFixed(2)}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan="5">No product data found.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
        {/* --- User Management Tab --- */}

        {activeTab === 'users' &&
          ROLE_PERMISSIONS[currentUserRole]?.includes("users") && (
            <section className="saas-users-section">
              <h2 className="saas-users-title">User Management</h2>

              {/* ROLE COUNTS */}
              <div className="saas-users-role-metrics">
                <span className="saas-users-metric saas-users-metric--wholesaler">
                  🏷️ Wholesalers: {wholesalerCount}
                </span>
                <span className="saas-users-metric saas-users-metric--retailer">
                  🛍️ Retailers: {retailerCount}
                </span>
              </div>

              {/* SEARCH */}
              <div className="saas-users-search-bar">
                <select
                  value={userSearchColumn}
                  onChange={(e) => setUserSearchColumn(e.target.value)}
                  className="saas-users-search-select"
                >
                  <option value="name">Name</option>
                  <option value="lastLogin">Last Login</option>
                  <option value="mobile">Mobile</option>
                  <option value="address">Address</option>
                  <option value="lastOrder">Last Order</option>
                  <option value="orders">Total Orders</option>
                  <option value="amount">Total Amount</option>
                  <option value="profit">Net Profit</option>
                  <option value="createdAt">Created At</option>
                  <option value="role">Role</option>
                </select>

                <input
                  type="text"
                  value={userSearchValue}
                  placeholder={`Search by ${userSearchColumn}`}
                  onChange={(e) => setUserSearchValue(e.target.value)}
                  className="saas-users-search-input"
                />
              </div>

              {/* SORT */}
              <div className="saas-users-sort-bar">
                <select
                  value={userSortField}
                  onChange={(e) => setUserSortField(e.target.value)}
                  className="saas-users-sort-select"
                >
                  <option value="createdAt">Created At</option>
                  <option value="lastLogin">Last Login</option>
                  <option value="lastOrder">Last Order</option>
                  <option value="orders">Total Orders</option>
                  <option value="amount">Total Amount</option>
                  <option value="profit">Net Profit</option>
                  <option value="name">Name</option>
                </select>

                <button
                  className="saas-users-sort-toggle"
                  onClick={() =>
                    setUserSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
                  }
                >
                  {userSortOrder === 'asc' ? '⬆ Ascending' : '⬇ Descending'}
                </button>
                <div className="saas-users-export-bar">
                  <button
                    className="saas-btn saas-btn--secondary"
                    onClick={handleExportUsers}
                    disabled={filteredAndSortedUsers.length === 0}
                  >
                    ⬇ Export Users
                  </button>
                </div>

              </div>

              {/* CONTENT */}
              {isUserLoading ? (
                <p className="saas-users-loading">Loading users…</p>
              ) : filteredAndSortedUsers.length === 0 ? (
                <p className="saas-users-empty">No users found.</p>
              ) : (
                <div className="saas-users-table-wrapper">

                  {/* HEADER */}
                  <div className="saas-users-table-header">
                    <div>Name</div>
                    <div>Last Login</div>
                    <div>Mobile</div>
                    <div>Address</div>
                    <div>Last Order</div>
                    <div>Orders</div>
                    <div>Total Amount</div>
                    <div>Created</div>
                    <div>Role</div>
                    <div>Actions</div>
                  </div>

                  {/* ROWS */}
                  <ul className="saas-users-table-body">
                    {filteredAndSortedUsers.map((user) => {
                      const stats = userOrderStats[user.id] || {};

                      return (
                        <li
                          key={user.id}
                          className="saas-users-row"
                          onClick={() =>
                            navigate(`/admin/users/${user.id}/orders`)
                          }
                        >
                          <div className="saas-users-cell saas-users-name">
                            {user.name || 'N/A'}
                          </div>

                          <div className="saas-users-cell saas-users-muted">
                            {formatDate(user.lastLogin)}
                          </div>

                          <div className="saas-users-cell saas-users-muted">
                            {user.mobile || '—'}
                          </div>

                          <div className="saas-users-cell saas-users-truncate">
                            {user.address || '—'}
                          </div>

                          <div className="saas-users-cell saas-users-muted">
                            {stats.lastOrderDate
                              ? formatDate(stats.lastOrderDate)
                              : '—'}
                          </div>

                          <div className="saas-users-cell saas-users-center">
                            {stats.totalOrders || 0}
                          </div>

                          <div className="saas-users-cell saas-users-amount">
                            ₹{(stats.lifetimeValue || 0).toLocaleString('en-IN')}
                          </div>



                          <div className="saas-users-cell saas-users-muted">
                            {formatDate(user.createdAt)}
                          </div>

                          <div className="saas-users-cell">
                            <span className={`saas-role saas-role--${user.role}`}>
                              {user.role}
                            </span>
                          </div>

                          <div
                            className="saas-users-cell saas-users-actions"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {/* ROLE SELECT (CONFIG DRIVEN) */}
                            <select
                              value={user.role}
                              onChange={(e) =>
                                handleUpdateUserRole(user.id, e.target.value)
                              }
                              className="saas-users-role-select"
                            >
                              {ROLE_KEYS.map(role => (
                                <option key={role} value={role}>
                                  {ROLE_CONFIG[role].label}
                                </option>
                              ))}
                            </select>

                            {/* DELETE USER */}
                            <button
                              className="saas-btn saas-btn--danger"
                              onClick={() => handleDeleteUser(user.id)}
                            >
                              Delete
                            </button>
                          </div>

                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </section>
          )}



        {activeTab === 'offline-billing' &&
          ROLE_PERMISSIONS[currentUserRole]?.includes("offline-billing") && (
            <div className="offline-pos-root">
              <div className="offline-pos-header"><div><span className="offline-pos-eyebrow">TANISHKA · STORE COUNTER</span><h2>Offline Billing</h2><p>Fast checkout · live stock · product-wise GST · printable invoice</p></div><span className="offline-pos-live"><i /> POS READY</span></div>

              {/* 🔑 HIDDEN BARCODE INPUT (USB / Bluetooth Scanner) */}
              <input
                ref={barcodeInputRef}
                type="text"
                value={scannedBarcode}
                onChange={(e) => setScannedBarcode(e.target.value)}
                autoFocus={isScanMode}
                style={{
                  position: "absolute",
                  opacity: isScanMode ? 1 : 0,
                  pointerEvents: "none",
                  height: 0,
                }}
              />


              <div className="offline-pos-layout">
                <div className="offline-pos-products-panel">
                  <h4>Select Products</h4>
                  <div className="dropdown-group">
                    <select
                      className="offline-pos-select"
                      value={offlinePricingKey}
                      onChange={(e) => setOfflinePricingKey(e.target.value)}
                    >
                      {ROLE_KEYS.map(role => (
                        <option
                          key={role}
                          value={ROLE_CONFIG[role].pricingKey}
                        >
                          {ROLE_CONFIG[role].label} Pricing
                        </option>
                      ))}
                    </select>

                    <select
                      className="offline-pos-select"
                      value={selectedOfflineCollectionId}
                      onChange={(e) => setSelectedOfflineCollectionId(e.target.value)}
                    >
                      <option value="">Select Collection</option>
                      {mainCollections.map((collection) => (
                        <option key={collection.id} value={collection.id}>
                          {collection.title}
                        </option>
                      ))}
                    </select>
                    <select
                      className="offline-pos-select"
                      value={selectedOfflineSubcollectionId}
                      onChange={(e) => setSelectedOfflineSubcollectionId(e.target.value)}
                      disabled={!selectedOfflineCollectionId}
                    >
                      <option value="">All Subcollection</option>
                      {offlineSubcollections.map((subcollection) => (
                        <option key={subcollection.id} value={subcollection.id}>
                          {subcollection.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Search Input */}
                  <input
                    type="text"
                    placeholder="Search products by name or code..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="offline-pos-search"
                  />
                  {/* 📷 CAMERA SCAN BUTTON */}
                  <button
                    className="offline-pos-btn offline-pos-btn--camera"
                    onClick={() => setShowCameraScanner(true)}
                    style={{
                      marginBottom: "12px",
                      padding: "8px 12px",
                      borderRadius: "6px",
                      border: "1px solid #ccc",
                      cursor: "pointer",
                    }}
                  >
                    📷 Scan with Camera
                  </button>
                  <button
                    className="offline-pos-btn"
                    onClick={() => {
                      setIsScanMode(true);

                      setTimeout(() => {
                        barcodeInputRef.current?.focus();
                      }, 50);
                    }}
                  >
                    🔫 Start Scanner
                  </button>

                  <button
                    className="offline-pos-btn offline-pos-btn--stop"
                    onClick={() => setIsScanMode(false)}
                  >
                    ✋ Stop Scanner
                  </button>

                  <button
                    onClick={() => {
                      localStorage.removeItem(
                        "offlineProductsByCodeCacheV2"
                      );

                      fetchAllProductsForScan();
                    }}
                  >
                    🔄 Refresh Products
                  </button>


                  {Object.keys(allProductsMap).length === 0 && (
                    <p style={{ fontSize: 12, color: "#888", marginBottom: "8px" }}>
                      ⏳ Loading barcode data…
                    </p>
                  )}


                  {isOfflineProductsLoading ? (
                    <p className="offline-pos-loading">Loading products...</p>
                  ) : filteredOfflineProducts.length > 0 ? (
                    <div className="offline-pos-product-grid">
                      {filteredOfflineProducts.map(product => {
                        // --- STOCK/VARIATION LOGIC SETUP (Requires offlineSelections state) ---
                        // 1. Get the current selection (or default to the first variant)
                        const currentSelection = offlineSelections[product.id] ||
                          (product.variations && product.variations.length > 0 ? product.variations[0] : null);

                        // 2. Get the stock for the currently selected item/variant
                        const availableStock = currentSelection ? Number(currentSelection.quantity) : Number(product.quantity || 0);

                        // 3. Calculate quantity in cart for this specific variant
                        // NOTE: getCartItemId must be available in this component's scope (imported from CartContext)
                        const cartItemId = getCartItemId({ ...product, variation: currentSelection });
                        const currentQuantityInCart = offlineCart[cartItemId]?.quantity || 0;

                        // 4. Check for stock limit
                        const isMaxStockReached = currentQuantityInCart >= availableStock;

                        const imagesToDisplay = product.images && product.images.length > 0 ? product.images : (product.image ? [product.image] : []);
                        const currentImage = imagesToDisplay.length > 0 ? (imagesToDisplay[0].url || imagesToDisplay[0].url || imagesToDisplay[0]) : '';
                        // ----------------------------------------------------------------------

                        return (
                          <div
                            key={product.id}
                            className={`offline-pos-product-card ${isMaxStockReached ? 'stock-limit' : ''}`}
                          >
                            {/* Product Details */}
                            <img
                              alt={product.productName}
                              src={currentImage}
                              className="offline-pos-product-image"
                              // 🛑 ADDED: onClick handler to open the full image modal 🛑
                              onClick={() => openImageModal(currentImage)}
                              style={{ cursor: 'pointer' }} // Visual hint that it's clickable
                            />
                            <div className="offline-pos-product-details">
                              <span className="offline-pos-product-name">{product.productName}</span>
                              <span className="offline-pos-product-code">{product.productCode}</span>

                              {/* Variation Selector */}
                              {product.variations && product.variations.length > 1 && (
                                <select
                                  className="offline-pos-variation"
                                  value={JSON.stringify(currentSelection || {})}
                                  onChange={(e) => {
                                    try {
                                      const parsed = JSON.parse(e.target.value);
                                      handleOfflineSelectionChange(product.id, parsed);
                                    } catch (err) {
                                      console.error("❌ Variant parse error:", err);
                                    }
                                  }}
                                >

                                  {product.variations.map((v, index) => (
                                    <option
                                      key={index}
                                      value={JSON.stringify(v)}
                                      disabled={Number(v.quantity) <= 0}
                                    >
                                      {v.color} {v.size} (Stock: {v.quantity})
                                    </option>
                                  ))}
                                </select>
                              )}

                             <span
  style={{
    display: "block",
    color: "red",
    fontWeight: "bold",
    fontSize: "16px"
  }}
>
  In Stock: {availableStock}
</span>
                            </div>

                            {/* Add to Cart Control */}
                            <div className="offline-pos-product-actions">
                               
                              <span className="offline-pos-stock-note">In Cart: {currentQuantityInCart}</span>
                              <button
                                // Pass the product and the currently selected variation to the handler
                                onClick={() => handleOfflineAddToCart(product, currentSelection)}
                                className={`offline-pos-add-btn ${isMaxStockReached ? 'disabled' : ''}`}
                                disabled={isMaxStockReached}
                              >
                                {isMaxStockReached ? (availableStock === 0 ? 'Out of Stock' : 'Max Stock Reached') : 'Add 1'}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="offline-pos-empty">
                      {selectedOfflineSubcollectionId
                        ? 'No products found for your search.'
                        : 'Please select a collection and subcollection to view products.'}
                    </p>
                  )}
                </div>

                <div className="offline-pos-cart-panel">
                  <h4>Billing Cart</h4>
                  {Object.keys(offlineCart).length > 0 ? (
                    <>
                      <ul className="offline-pos-cart-list">
                        {/* CRITICAL: Iterate over pricedOfflineCart, not offlineCart */}
                        {Object.values(pricedOfflineCart).map((item) => {
                          // Calculate the final unit price and line total for display
                          const unitPrice = typeof item.calculatedPrice === 'number'
                            ? item.calculatedPrice
                            : (item.price !== undefined && item.price !== null ? parseFloat(item.price) : 0);
                          const lineTotal = unitPrice * item.quantity;

                          return (
                            <li key={item.id} className="offline-pos-cart-item">
                              <div className="offline-pos-cart-details">
                                <span className="offline-pos-cart-name">{item.productName}</span>
                                <span className="offline-pos-cart-code">{item.productCode}</span>
                                {/* Display Variation */}
                                {item.variation && (item.variation.color || item.variation.size) && (
                                  <span className="offline-pos-cart-info offline-pos-variation-detail">
                                    {item.variation.color} {item.variation.size}
                                  </span>
                                )}

                                {/* UPDATED: Display calculated unit price */}
                                <span className="offline-pos-cart-info offline-pos-unit-price">
                                  ₹{unitPrice.toFixed(2)} / unit
                                </span>
                                {(() => {
                                  const gst = getProductGstDetails(item, lineTotal);
                                  return (
                                    <span className="offline-pos-gst-line">
                                      GST {gst.rate}% ({gst.type}): ₹{gst.tax.toFixed(2)}
                                    </span>
                                  );
                                })()}
                              </div>
                              <div className="offline-pos-cart-controls">
                                {/* NEW: Display line total */}
                                <span className="offline-pos-cart-info offline-pos-line-total">
                                  <strong className="offline-pos-line-total-amount">₹{lineTotal.toFixed(2)}</strong>
                                </span>

                                <button type="button" aria-label={`Decrease quantity of ${item.productName}`} onClick={() => handleOfflineRemoveFromCart(item.id)} className="offline-pos-qty-btn">−</button>
                                <span className="offline-pos-cart-qty">{item.quantity}</span>
                                <button
                                  type="button"
                                  aria-label={`Increase quantity of ${item.productName}`}
                                  onClick={() => handleOfflineIncrementCartItem(item.id)}
                                  className="offline-pos-qty-btn"
                                  disabled={Number(item.quantity || 0) >= Number(item.availableStock ?? 0)}
                                >
                                  +
                                </button>
                              </div>
                            </li>
                          );
                        })}
                      </ul>

                      {/* NEW: Editable Total Input */}
                      <div className="offline-pos-total">
                        {/* FIX: Removed the extra ₹ symbol (₹₹ -> ₹) */}
                        <p className="offline-pos-calculated-total">
                          Calculated Total: ₹{finalTotal.toFixed(2)}
                        </p>
                        <label htmlFor="edited-total-input">Final Total:</label>
                        <input
                          id="edited-total-input"
                          type="number"
                          value={editedTotal}
                          onChange={(e) => setEditedTotal(e.target.value)}
                          placeholder="Enter final total"
                          className="offline-pos-total-input"
                        />
                      </div>
                      <div className="offline-pos-gst-summary">
                        <strong>Product-wise GST</strong>
                        <p>GST is calculated automatically from each product's saved GST rate and tax type.</p>
                        <p className="gst-amount">Total GST: ₹{gstAmount.toFixed(2)}</p>
                        {offlineGstSummary.addedTax > 0 && (
                          <p className="gst-amount">GST added to bill (exclusive products): ₹{offlineGstSummary.addedTax.toFixed(2)}</p>
                        )}
                        {offlineGstSummary.includedTax > 0 && (
                          <p className="gst-amount">GST already included in prices: ₹{offlineGstSummary.includedTax.toFixed(2)}</p>
                        )}
                      </div>
                      <div className="offline-pos-shipping">
  <label className="offline-pos-shipping-check">
    <input
      type="checkbox"
      checked={isShippingApplied}
      onChange={(e) => setIsShippingApplied(e.target.checked)}
    />
    Apply Shipping (₹{SHIPPING_CHARGE})
  </label>

  {isShippingApplied && (
    <p className="offline-pos-shipping-amount">
      Shipping: ₹{SHIPPING_CHARGE}
    </p>
  )}
</div>
                      <div className="offline-pos-customer">
                        <div className="offline-pos-section-heading">
                          <span className="offline-pos-section-icon">01</span>
                          <div><h4>Customer details</h4><p>Details for the invoice and optional WhatsApp receipt</p></div>
                        </div>

                        <input
                          type="text"
                          placeholder="Full name *"
                          value={offlineCustomer.fullName}
                          onChange={(e) => handleOfflineCustomerChange('fullName', e.target.value)}
                        />

                        <input
                          type="email"
                          placeholder="Email (optional)"
                          value={offlineCustomer.email}
                          onChange={(e) => handleOfflineCustomerChange('email', e.target.value)}
                        />

                        <input
                          type="tel"
                          placeholder="Mobile number (for WhatsApp receipt)"
                          value={offlineCustomer.phoneNumber}
                          onChange={(e) => handleOfflineCustomerChange('phoneNumber', e.target.value)}
                        />
                        <input
  type="text"
  placeholder="GSTIN (optional)"
  value={offlineCustomer.gst || ""}
  onChange={(e) =>
    handleOfflineCustomerChange("gst", e.target.value)
  }
/>

                        <input
                          type="text"
                          placeholder="Address Line 1"
                          value={offlineCustomer.addressLine1}
                          onChange={(e) => handleOfflineCustomerChange('addressLine1', e.target.value)}
                        />

                        <input
                          type="text"
                          placeholder="Address Line 2 (optional)"
                          value={offlineCustomer.addressLine2}
                          onChange={(e) => handleOfflineCustomerChange('addressLine2', e.target.value)}
                        />

                        <input
                          type="text"
                          placeholder="City"
                          value={offlineCustomer.city}
                          onChange={(e) => handleOfflineCustomerChange('city', e.target.value)}
                        />

                        <input
                          type="text"
                          placeholder="State"
                          value={offlineCustomer.state}
                          onChange={(e) => handleOfflineCustomerChange('state', e.target.value)}
                        />

                        <input
                          type="text"
                          placeholder="Pincode"
                          value={offlineCustomer.pincode}
                          onChange={(e) => handleOfflineCustomerChange('pincode', e.target.value)}
                        />
                      </div>

                      <div className="offline-pos-payment-field">
                        <label htmlFor="offline-payment-method">Payment method</label>
                        <select id="offline-payment-method" value={offlinePaymentMethod} onChange={(e) => setOfflinePaymentMethod(e.target.value)}>
                          <option value="Cash">Cash</option>
                          <option value="UPI">UPI</option>
                          <option value="Card">Debit / Credit Card</option>
                          <option value="Bank Transfer">Bank Transfer</option>
                          <option value="Credit">Credit / Pay Later</option>
                          <option value="Other">Other</option>
                        </select>
                      </div>

                      <label className="offline-pos-whatsapp-option">
                        <input
                          type="checkbox"
                          checked={sendInvoiceOnWhatsApp}
                          onChange={(e) => setSendInvoiceOnWhatsApp(e.target.checked)}
                        />
                        <span className="offline-pos-whatsapp-mark">WA</span>
                        <span><strong>Share invoice on WhatsApp</strong><small>Opens WhatsApp with the invoice PDF link after billing.</small></span>
                      </label>


                      <button type="button" onClick={handleFinalizeSale} className="offline-pos-checkout-btn">
                        Finalize Sale
                      </button>
                      <button
                        type="button"
                        className="offline-pos-secondary-btn"
                        onClick={handlePrintCurrentCart}
                      >
                        🖨 Print Current Cart / Save as PDF
                      </button>
                      <button
  type="button"
  onClick={handleClearOfflineCart}
  className="offline-pos-clear-btn"
>
  Clear cart
</button>


                    </>
                  ) : (
                    <p>Cart is empty. Add products to start billing.</p>
                  )}
                </div>
              </div>
            </div>
          )}
        {modalImage && (
          <div className="image-modal-backdrop" onClick={closeImageModal}>
            <div
              className="image-modal-content"
              // Stop propagation so clicking the image itself doesn't close the modal
              onClick={(e) => e.stopPropagation()}
            >
              <button className="close-modal-btn" onClick={closeImageModal}>&times;</button>
              <img src={modalImage} alt="Full Product View" className="full-image-display" />
            </div>
          </div>
        )}

      </div>
      {showInvoice && invoiceData && (
        <div className="offline-pos-invoice-print">
          <div className="offline-pos-invoice-actions">
            <button type="button" onClick={() => window.print()}>Print current cart</button>
            <button type="button" onClick={downloadInvoicePDF}>Download receipt PDF</button>
            <button type="button" onClick={() => { setShowInvoice(false); setIsCartPreviewReceipt(false); }}>Close</button>
          </div>
          <div id="invoice-pdf" className="offline-pos-invoice">

            {/* ================= HEADER (CENTER) ================= */}
            <div className="offline-pos-invoice-header">
              <h2>TANISHKA IMITATION JEWELLERY</h2>
              <p>Streets Of Europe, Hinjewadi, Pune</p>
              <p>Pune, PIN CODE-412101.</p>
              <p>Phone :- +91 78978 97441</p>
              <p><strong>GSTN :</strong> 27CRAPA0906N1Z0</p>
            </div>

            {/* ========== INVOICE + CUSTOMER INFO (LEFT / TOP) ========== */}
            <div className="offline-pos-invoice-top">
              <p><strong>Invoice No :</strong> {invoiceData.invoiceNumber}</p>
              <p><strong>Date :</strong> {invoiceData.invoiceDate.toLocaleDateString()}</p>
              <p><strong>Customer :</strong> {invoiceData.customer.fullName || 'Walk-in Customer'}</p>
              <p><strong>Mobile :</strong> {invoiceData.customer.phoneNumber || '—'}</p>
              {invoiceData.customer.email && <p><strong>Email :</strong> {invoiceData.customer.email}</p>}
              <p><strong>Address :</strong> {[invoiceData.customer.addressLine1, invoiceData.customer.addressLine2, invoiceData.customer.city, invoiceData.customer.state, invoiceData.customer.pincode].filter(Boolean).join(', ') || '—'}</p>
              <p><strong>GSTN No :</strong> {invoiceData.customer.gst || 'N/A'}</p>
              <p><strong>Payment :</strong> {invoiceData.paymentMethod || 'N/A'}</p>
            </div>

            {/* Compact thermal-receipt item list */}
            <table className="offline-pos-invoice-table">
              <thead><tr><th>Item / GST</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead>
              <tbody>
                {invoiceData.items.map((item, index) => {
                  const lineTotal = Number(item.price || 0) * Number(item.quantity || 0);
                  return (
                    <tr key={item.productId || `${item.productCode || index}-${index}`}>
                      <td>
                        <strong>{item.productName || "Item"}</strong>
                        <small className="offline-pos-receipt-item-meta">Code: {item.productCode || "—"}</small>
                        <small className="offline-pos-receipt-item-meta">GST {Number(item.gstRate || 0)}% · {item.gstType || "exclusive"}: ₹{Number(item.gstAmount || 0).toFixed(2)}</small>
                        {item.variation?.size && <small className="offline-pos-receipt-item-meta">Variant: {item.variation.size}</small>}
                      </td>
                      <td>{Number(item.quantity || 0)}</td>
                      <td>₹{Number(item.price || 0).toFixed(2)}</td>
                      <td>₹{lineTotal.toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* ================= TOTALS (RIGHT) ================= */}
            <div className="offline-pos-invoice-summary">
              <div>
                <span>Total :</span>
                <span>₹{invoiceData.subtotal.toFixed(2)}</span>
              </div>
              {Number(invoiceData.includedGstAmount || 0) > 0 && (
                <div>
                  <span>GST included in item prices :</span>
                  <span>₹{Number(invoiceData.includedGstAmount || 0).toFixed(2)}</span>
                </div>
              )}
              {Number(invoiceData.gstAddedToTotal || 0) > 0 && (
                <div>
                  <span>GST added (exclusive items) :</span>
                  <span>₹{Number(invoiceData.gstAddedToTotal || 0).toFixed(2)}</span>
                </div>
              )}
              {invoiceData.shippingFee > 0 && (
  <div>
    <span>Shipping :</span>
    <span>₹{invoiceData.shippingFee.toFixed(2)}</span>
  </div>
)}
              <div className="offline-pos-invoice-net-total">
                <span>Net Total :</span>
                <span>₹{invoiceData.total.toFixed(2)}</span>
              </div>
            </div>

            {/* ================= AMOUNT IN WORDS ================= */}
            <p className="offline-pos-invoice-words">
              {convertNumberToWords(invoiceData.total)} Only
            </p>

            <div className="offline-pos-receipt-thanks">Thank you for shopping with us!<br />Please visit again.</div>

            {/* ================= FOOTER ================= */}
            <div className="offline-pos-invoice-footer">
              <div>
                <p><strong>Invoice No :</strong> {invoiceData.invoiceNumber}</p>
                <p><strong>Date :</strong> {invoiceData.invoiceDate.toLocaleDateString()}</p>
              </div>

              <div className="offline-pos-invoice-signature">
                <p>For TANISHKA IMITATION JEWELLERY</p>
                <div className="offline-pos-invoice-signature-line">Receiver's Signature</div>
              </div>
            </div>

          </div>
        </div>
      )}
      {/* ===============================
   LAST SCANNED PRODUCT POPUP
=============================== */}
      {lastScannedProduct && (
        <div className="scan-popup">
          <div className="scan-popup-content">
            <div className="scan-success">✅ Added</div>

            <div className="scan-product-name">
              {lastScannedProduct.name}
            </div>

            <div className="scan-product-code">
              Code: {lastScannedProduct.code}
            </div>
          </div>
        </div>
      )}

      {/* 📷 CAMERA SCANNER MODAL */}
      {showCameraScanner && (
        <div className="camera-scanner-modal">
          <div className="scanner-container">

            {/* Camera Feed Wrapper */}
            <div className="camera-wrapper">
              <div id="camera-scanner" />

              {/* Overlay INSIDE camera wrapper */}
              <div className="scanner-overlay">
                <div className="laser-line"></div>
              </div>
            </div>

            <button
              onClick={() => setShowCameraScanner(false)}
              className="close-scanner-btn"
            >
              Close Scanner
            </button>

          </div>
        </div>
      )}
      {variantSelectionProduct && (
  <div className="variant-modal-backdrop">
    <div className="variant-modal">
      <h3>Select Variant</h3>

      {variantSelectionProduct.variations.map((variant, index) => (
        <button
          key={index}
          disabled={Number(variant.quantity) <= 0}
          onClick={() => {
            handleOfflineAddToCart(
              variantSelectionProduct,
              variant
            );
            setVariantSelectionProduct(null);
          }}
        >
          {variant.color} {variant.size}
          (Stock: {variant.quantity})
        </button>
      ))}

      <button
        onClick={() => setVariantSelectionProduct(null)}
      >
        Cancel
      </button>
    </div>
  </div>
)}




      {deodapConnectionReport && (
        <div className="deodap-report-backdrop" role="presentation" onClick={() => setDeodapConnectionReport(null)}>
          <section className="deodap-report-dialog" role="dialog" aria-modal="true" aria-labelledby="deodap-report-title" onClick={event => event.stopPropagation()}>
            <div className="deodap-report-heading">
              <div><span className="deodap-eyebrow">DEODAP SYNC REPORT</span><h3 id="deodap-report-title">Connection results</h3></div>
              <button type="button" aria-label="Close report" onClick={() => setDeodapConnectionReport(null)}>×</button>
            </div>
            <div className="deodap-report-summary">
              <span className="is-connected"><strong>{deodapConnectionReport.connected?.length || 0}</strong> Connected</span>
              <span className="is-failed"><strong>{deodapConnectionReport.failed?.length || 0}</strong> Failed</span>
              <span className="is-unmatched"><strong>{deodapConnectionReport.unmatched?.length || 0}</strong> Unmatched</span>
              <span className="is-ambiguous"><strong>{deodapConnectionReport.ambiguous?.length || 0}</strong> Ambiguous</span>
            </div>
            {deodapConnectionReport.message && <p>{deodapConnectionReport.message}</p>}
            <div className="deodap-report-list">
              {(deodapConnectionReport.connected || []).map((item, index) => <div className="deodap-report-row is-connected" key={`connected-${item.key || index}`}><span>✓</span><div><strong>{item.title}</strong><small>Code: {item.productCode || '—'} · SKU: {item.sku || '—'}</small></div><b>Connected</b></div>)}
              {(deodapConnectionReport.failed || []).map((item, index) => <div className="deodap-report-row is-failed" key={`failed-${item.key || index}`}><span>✕</span><div><strong>{item.title}</strong><small>Code: {item.productCode || '—'} · SKU: {item.sku || '—'} · {item.error || 'Update failed'}</small></div><b>Failed</b></div>)}
              {(deodapConnectionReport.unmatched || []).map((product, index) => <div className="deodap-report-row is-unmatched" key={`unmatched-${product.destination || ''}-${product.id || index}`}><span>○</span><div><strong>{product.productName || product.name || 'Unnamed product'}</strong><small>Code: {product.productCode || '—'} · No unique scraper SKU/code match found</small></div><b>Not connected</b></div>)}
              {(deodapConnectionReport.ambiguous || []).map((item, index) => <div className="deodap-report-row is-ambiguous" key={`ambiguous-${item.product?.destination || ''}-${item.product?.id || index}`}><span>!</span><div><strong>{item.product?.productName || item.product?.name || 'Unnamed product'}</strong><small>Code: {item.product?.productCode || '—'} · {item.reason || `${item.count} scraper records share this code; choose one manually.`}</small></div><b>Needs review</b></div>)}
            </div>
            <div className="deodap-report-footer"><button type="button" onClick={() => setDeodapConnectionReport(null)}>Close</button></div>
          </section>
        </div>
      )}
    </div>
  );
};

export default AdminPage;
