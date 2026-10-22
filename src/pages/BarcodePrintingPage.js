import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  collection,
  getDocs,
  doc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";

import { db } from "../firebase";
import QRCode from "qrcode";

import "./Barcode.css";

// QR labels encode productCode; the visible label starts with SKU, falling back to product code.
const getProductCode = (product) => String(product?.productCode || "").trim();
const getProductSku = (product) => String(product?.sku || product?.SKU || product?.productSku || product?.variantSku || "").trim();
const getProductSkuOrCode = (product) => {
  const sku = getProductSku(product);
  const code = getProductCode(product);
  return sku ? `SKU: ${sku}` : `Code: ${code || "-"}`;
};
const getProductCodeLabel = (product) => `Product Code: ${getProductCode(product) || "-"}`;
const getProductPrice = (product) => {
  const candidates = [product?.resolvedRetailPrice, product?.sellingPrice, product?.salePrice, product?.price, product?.retailPrice];
  const value = candidates.find((v) => v !== undefined && v !== null && v !== "");
  if (value === undefined) return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
};
const getCompareAtPrice = (product) => {
  const candidates = [product?.compareAtPrice, product?.compare_at_price, product?.mrp, product?.originalPrice, product?.original_price];
  const value = candidates.find((v) => v !== undefined && v !== null && v !== "");
  if (value === undefined) return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
};
const getDiscountPercentage = (product) => {
  const candidates = [product?.discountPercentage, product?.discount_percentage, product?.discountPercent];
  const value = candidates.find((v) => v !== undefined && v !== null && v !== "");
  if (value !== undefined) {
    const amount = Number(String(value).replace("%", "").trim());
    if (Number.isFinite(amount)) return Math.max(0, amount);
  }
  const selling = getProductPrice(product);
  const compareAt = getCompareAtPrice(product);
  if (selling !== null && compareAt !== null && compareAt > selling && compareAt > 0) return Math.round(((compareAt - selling) / compareAt) * 100);
  return null;
};
const formatLabelPrice = (product) => {
  const price = getProductPrice(product);
  return price === null ? "Selling: N/A" : `Selling: ₹${price.toFixed(2)}`;
};
const formatCompareAtPrice = (product) => {
  const price = getCompareAtPrice(product);
  return price === null ? "" : `MRP: ₹${price.toFixed(2)}`;
};
const formatDiscount = (product) => {
  const discount = getDiscountPercentage(product);
  return discount === null ? "" : `${discount.toFixed(discount % 1 ? 1 : 0)}% OFF`;
};

/* =========================================================
   SCREEN QR LABEL
========================================================= */

const BarcodeLabel = ({
  product,
  printLayout,
}) => {
  const svgRef = useRef(null);

  useEffect(() => {
    if (!svgRef.current) return;

    const generateQRCode = async () => {
      svgRef.current.innerHTML = "";

      const productCode = getProductCode(product);
      if (!productCode) return;

      try {
        const qrSvg = await QRCode.toString(
          productCode,
          {
            type: "svg",
            errorCorrectionLevel: "L",
            margin: 0,
            color: {
              dark: "#000000",
              light: "#ffffff",
            },
          }
        );

        const parser = new DOMParser();

        const qrDocument =
          parser.parseFromString(
            qrSvg,
            "image/svg+xml"
          );

        const generatedSvg =
          qrDocument.documentElement;

        Array.from(
          generatedSvg.attributes
        ).forEach((attribute) => {
          svgRef.current.setAttribute(
            attribute.name,
            attribute.value
          );
        });

        Array.from(
          generatedSvg.childNodes
        ).forEach((node) => {
          svgRef.current.appendChild(
            node.cloneNode(true)
          );
        });

        svgRef.current.setAttribute(
          "data-qr-value",
          productCode
        );

        svgRef.current.setAttribute(
          "preserveAspectRatio",
          "none"
        );

        svgRef.current.style.display =
          "block";

        svgRef.current.style.margin = "0";
        svgRef.current.style.padding = "0";
        svgRef.current.style.overflow =
          "visible";
      } catch (error) {
        console.error(
          "QR generation failed:",
          error
        );
      }
    };

    generateQRCode();
  }, [product?.productCode]);

  const skuOrCode = getProductSkuOrCode(product);
  const productPrice = formatLabelPrice(product);
  const compareAtPrice = formatCompareAtPrice(product);
  const discount = formatDiscount(product);

  const isLarge =
    printLayout ===
    "THERMAL_47_5X25";

  return (
    <div
      className={`barcode-label ${
        isLarge
          ? "label-47-5-25"
          : "label-32-5-18"
      }`}
    >
      <svg
        ref={svgRef}
        className="screen-qr"
        data-product-id={String(
          product?.id || ""
        ).trim()}
      />

      <div className="screen-label-text">
        <strong className="screen-label-sku" title={skuOrCode}>{skuOrCode}</strong>
        <div className="screen-label-code">{getProductCodeLabel(product)}</div>
        {compareAtPrice && <div className="screen-label-compare">{compareAtPrice}</div>}
        <div className="screen-label-price">{productPrice}</div>
        {discount && <div className="screen-label-discount">{discount}</div>}
      </div>
    </div>
  );
};


/* =========================================================
   MAIN PAGE
========================================================= */

const BarcodePrintingPage = () => {
  const pdfRef = useRef(null);

  /* =======================================================
     STATE
  ======================================================= */

  const [
    collections,
    setCollections,
  ] = useState([]);

  const [
    products,
    setProducts,
  ] = useState([]);
  const [isProductsLoading, setIsProductsLoading] = useState(false);
  const [printStatusFilter, setPrintStatusFilter] = useState("not-printed");
  const [printedCounts, setPrintedCounts] = useState({});
  const [isPrintHistoryLoading, setIsPrintHistoryLoading] = useState(true);
  const [isSavingPrintHistory, setIsSavingPrintHistory] = useState(false);

  const [
    selectedCollectionId,
    setSelectedCollectionId,
  ] = useState("");

  const [
    selectedProductIds,
    setSelectedProductIds,
  ] = useState([]);
const [productCodeSearch, setProductCodeSearch] = useState("");
  const [
    productQuantities,
    setProductQuantities,
  ] = useState({});

  /*
   * Default:
   *
   * 32.5 × 18 mm
   */
  const [
    printLayout,
    setPrintLayout,
  ] = useState(
    "THERMAL_32_5X18"
  );


  /* =======================================================
     LOAD PERSISTENT PRINT HISTORY FROM FIRESTORE
     One compact document per product source; survives browser
     refreshes and is shared across signed-in devices.
  ======================================================= */

  useEffect(() => {
    let cancelled = false;
    const loadPrintHistory = async () => {
      setIsPrintHistoryLoading(true);
      try {
        const historySnap = await getDocs(collection(db, "barcodePrintHistory"));
        const history = {};
        historySnap.forEach((historyDoc) => {
          const data = historyDoc.data() || {};
          const key = data.trackingKey || historyDoc.id;
          history[key] = Math.max(0, Number(data.printedQuantity) || 0);
        });
        if (!cancelled) setPrintedCounts(history);
      } catch (error) {
        console.error("Could not load barcode print history from Firestore:", error);
        if (!cancelled) alert("Barcode print history could not be loaded from Firebase. Check Firestore rules and connection before printing.");
      } finally {
        if (!cancelled) setIsPrintHistoryLoading(false);
      }
    };
    loadPrintHistory();
    return () => { cancelled = true; };
  }, []);

  /* =======================================================
     FETCH COLLECTIONS
  ======================================================= */

  useEffect(() => {
    const fetchCollections =
      async () => {
        try {
          const snap =
            await getDocs(
              collection(
                db,
                "collections"
              )
            );

          setCollections(
            snap.docs.map((doc) => ({
              id: doc.id,
              ...doc.data(),
            }))
          );
        } catch (error) {
          console.error(
            "Error fetching collections:",
            error
          );
        }
      };

    fetchCollections();
  }, []);


  /* =======================================================
     FETCH ALL PRODUCTS FOR THE SELECTED COLLECTION
     Products live under each subcollection, in both `products`
     and `appProducts`. The user selects only a collection.
  ======================================================= */

  useEffect(() => {
    if (!selectedCollectionId) {
      setIsProductsLoading(false);
      setProducts([]);
      setSelectedProductIds([]);
      setProductQuantities({});
      setProductCodeSearch("");
      return;
    }

    let cancelled = false;
    const fetchCollectionProducts = async () => {
      setIsProductsLoading(true);
      setProducts([]);
      setSelectedProductIds([]);
      setProductQuantities({});
      try {
        const subsSnap = await getDocs(
          collection(db, "collections", selectedCollectionId, "subcollections")
        );
        const batches = await Promise.all(subsSnap.docs.map(async (subDoc) => {
          const subData = subDoc.data() || {};
          const basePath = ["collections", selectedCollectionId, "subcollections", subDoc.id];
          const [productsSnap, appProductsSnap] = await Promise.all([
            getDocs(collection(db, ...basePath, "products")),
            getDocs(collection(db, ...basePath, "appProducts")),
          ]);
          const pricing = subData?.tieredPricing || {};
          const retailTierSource = pricing.retail || pricing.retailPrice || pricing.Retail || pricing.customer || [];
          const retailTiers = Array.isArray(retailTierSource)
            ? [...retailTierSource].sort((a, b) => Number(a.min_quantity || a.minQuantity || 1) - Number(b.min_quantity || b.minQuantity || 1))
            : [];
          const firstRetailTier = retailTiers[0];
          const tierPriceRaw = firstRetailTier?.price ?? firstRetailTier?.retailPrice ?? firstRetailTier?.amount;
          const tierPrice = tierPriceRaw === undefined || tierPriceRaw === null || tierPriceRaw === "" ? null : Number(tierPriceRaw);
          const mapProducts = (snapshot, destination) => snapshot.docs.map((productDoc) => {
            const data = productDoc.data() || {};
            const productPriceCandidates = [data.sellingPrice, data.salePrice, data.price, data.retailPrice, data.mrp];
            const ownPriceRaw = productPriceCandidates.find((value) => value !== undefined && value !== null && value !== "");
            const ownPrice = ownPriceRaw === undefined ? null : Number(ownPriceRaw);
            return {
              ...data,
              id: `${subDoc.id}__${destination}__${productDoc.id}`,
              productDocumentId: productDoc.id,
              destination,
              collectionId: selectedCollectionId,
              subcollectionId: subDoc.id,
              subcollectionName: subData.name || subData.subcollectionName || subData.title || "",
              // Retail price comes from the owning subcollection's retail tier first.
              resolvedRetailPrice: Number.isFinite(tierPrice) && tierPrice !== null
                ? tierPrice
                : (Number.isFinite(ownPrice) ? ownPrice : null),
            };
          });
          return [...mapProducts(productsSnap, "products"), ...mapProducts(appProductsSnap, "appProducts")];
        }));
        const allProducts = batches.flat();
        if (!cancelled) {
          allProducts.sort((a, b) => String(a.productName || a.name || "").localeCompare(String(b.productName || b.name || "")));
          setProducts(allProducts);
        }
      } catch (error) {
        console.error("Error fetching barcode products for collection:", error);
        if (!cancelled) setProducts([]);
      } finally {
        if (!cancelled) setIsProductsLoading(false);
      }
    };

    fetchCollectionProducts();
    return () => { cancelled = true; };
  }, [selectedCollectionId]);

  /* =======================================================
     SELECTED PRODUCTS
  ======================================================= */

  const selectedProducts =
    useMemo(() => {
      return products.filter(
        (product) =>
          selectedProductIds.includes(
            product.id
          )
      );
    }, [
      products,
      selectedProductIds,
    ]);
/* =======================================================
   PRODUCT CODE SEARCH
======================================================= */

const filteredProducts = useMemo(() => {
  const search = productCodeSearch.trim().toLowerCase();

  if (!search) {
    return products;
  }

  return products.filter((product) =>
    String(product?.productCode || "")
      .toLowerCase()
      .includes(search)
  );
}, [products, productCodeSearch]);

  /* =======================================================
     EXPAND QUANTITIES
  ======================================================= */
const getProductStock = (product) => {
  if (!product) return 0;

  // Product has variants
  if (
    Array.isArray(product.variations) &&
    product.variations.length > 0
  ) {
    return product.variations.reduce(
      (total, variation) =>
        total + Math.max(
          0,
          Number(variation?.quantity) || 0
        ),
      0
    );
  }

  // Normal product
  return Math.max(
    0,
    Number(product?.quantity) || 0
  );
};
  const getPrintTrackingKey = (product) => [
    product?.collectionId || "",
    product?.subcollectionId || "",
    product?.destination || "",
    product?.productDocumentId || product?.id || "",
  ].join("::");

  const getPrintedCount = (product) => Math.max(0, Number(printedCounts[getPrintTrackingKey(product)] || 0));
  const getRemainingPrintQuantity = (product) => Math.max(0, getProductStock(product) - getPrintedCount(product));


  const printableProducts = useMemo(() => {
  const result = [];

  selectedProducts.forEach((product) => {
    const stock = getProductStock(product);
    const remaining = Math.max(0, stock - Number(printedCounts[[product?.collectionId || "", product?.subcollectionId || "", product?.destination || "", product?.productDocumentId || product?.id || ""].join("::")] || 0));

    const quantity = Math.min(remaining, Math.max(
      0,
      Number(
        productQuantities[product.id] ?? remaining
      )
    ));

    for (let i = 0; i < quantity; i++) {
      result.push({
        ...product,
        __printIndex: i,
      });
    }
  });

  return result;
}, [
  selectedProducts,
  productQuantities,
  printedCounts,
]);

const productsForDisplay = useMemo(() => filteredProducts.filter((product) => {
  const stock = getProductStock(product);
  const printed = getPrintedCount(product);
  if (printStatusFilter === "printed") return stock > 0 && printed >= stock;
  if (printStatusFilter === "partial") return printed > 0 && printed < stock;
  if (printStatusFilter === "not-printed") return stock > 0 && printed < stock;
  return true;
}), [filteredProducts, printStatusFilter, printedCounts]);


  /* =======================================================
     NEW PRODUCT
  ======================================================= */

  const isNewProduct = (
    product
  ) => {
    if (!product) return false;

    const createdAt =
      product.createdAt ||
      product.created_at ||
      product.createdDate;

    if (!createdAt) return false;

    let createdDate;

    if (
      typeof createdAt?.toDate ===
      "function"
    ) {
      createdDate =
        createdAt.toDate();
    } else {
      createdDate =
        new Date(createdAt);
    }

    if (
      Number.isNaN(
        createdDate.getTime()
      )
    ) {
      return false;
    }

    const difference =
      Date.now() -
      createdDate.getTime();

    const sevenDays =
      7 *
      24 *
      60 *
      60 *
      1000;

    return (
      difference >= 0 &&
      difference <= sevenDays
    );
  };


  /* =======================================================
     TOGGLE PRODUCT
  ======================================================= */

 const toggleProduct = (productId) => {
  setSelectedProductIds((previous) => {
    if (previous.includes(productId)) {
      return previous.filter(
        (id) => id !== productId
      );
    }

    return [
      ...previous,
      productId,
    ];
  });

  setProductQuantities((previous) => {
    if (previous[productId] !== undefined) {
      return previous;
    }

    const product = products.find(
      (item) => item.id === productId
    );

    return {
      ...previous,
      [productId]: getRemainingPrintQuantity(product),
    };
  });
};


  /* =======================================================
     SELECT ALL
  ======================================================= */

  const selectAllProducts = () => {
  const ids = products.map(
    (product) => product.id
  );

  const quantities = {};

  products.forEach((product) => {
    quantities[product.id] =
      productQuantities[product.id] ??
      getRemainingPrintQuantity(product);
  });

  setSelectedProductIds(ids);
  setProductQuantities(quantities);
};


  /* =======================================================
     CLEAR ALL
  ======================================================= */

  const clearAllProducts =
    () => {
      setSelectedProductIds([]);
      setProductQuantities({});
    };


  /* =======================================================
     TOTAL LABELS
  ======================================================= */

  const totalLabelCount =
    printableProducts.length;


  /* =======================================================
     EXACT PRN-BASED PRINT CONFIGURATION
     
     IMPORTANT:
     
     We are NOT treating the TSC dot coordinates
     as CSS millimetres.

     The PRN is the reference for the visual layout.

     FORMAT 1:
     SIZE 47.5 mm, 25 mm

     QRCODE:
     333,127,L,4,A,180,M2,S7

     TEXT:
     330,176,"0",180,12,12
     200,127,"0",180,12,12
     200,76,"0",180,12,12

     FORMAT 2:
     SIZE 32.5 mm, 18 mm

     QRCODE:
     224,84,L,3,A,180,M2,S7

     TEXT:
     234,120,"0",180,10,9
     136,85,"0",180,9,9
     136,48,"0",180,9,9
  ======================================================= */

  const PRINT_CONFIGS = {
    THERMAL_47_5X25: {
      width: 47.5,
      height: 25,

      /*
       * QR LEFT
       */
      qrLeft: 3.0,
      qrTop: 4.0,
      qrSize: 14.8,

      /*
       * TEXT RIGHT
       */
      textLeft: 19.0,
      textTop: 4.0,
      textWidth: 26.0,

      titleFont: 7.2,
      subFont: 6.2,
      codeFont: 6.2,
      titleTop: 2.0,
      subTop: 8.0,
      codeTop: 5.8,
      priceTop: 12.0,
      compareTop: 9.0,
      discountTop: 15.4,
    },

THERMAL_32_5X18: {
  width: 32.5,
  height: 18,

  /* QR */
  qrLeft: 1.3,
  qrTop: 3.5,
  qrSize: 10.5,
  /* TEXT */
  textLeft: 13.0,
  textTop: 1.1,
  textWidth: 18.5,
  /* TEXT SIZE */
  titleFont: 5.1,
  subFont: 4.3,
  codeFont: 4.5,
  /* SKU then prices */
  titleTop: 1.2,
  subTop: 5.0,
  codeTop: 11.4,
  priceTop: 7.3,
  compareTop: 5.0,
  discountTop: 10.0,
},
  };


  const currentPrintConfig =
    PRINT_CONFIGS[
      printLayout
    ] ||
    PRINT_CONFIGS
      .THERMAL_32_5X18;


  /* =======================================================
     HTML ESCAPE
  ======================================================= */

  const escapeHtml = (
    value
  ) => {
    return String(
      value ?? ""
    )
      .replace(
        /&/g,
        "&amp;"
      )
      .replace(
        /</g,
        "&lt;"
      )
      .replace(
        />/g,
        "&gt;"
      )
      .replace(
        /"/g,
        "&quot;"
      )
      .replace(
        /'/g,
        "&#039;"
      );
  };


  /* =======================================================
     CREATE PRINT QR
     
     QR PAYLOAD:
     PRODUCT CODE ONLY
  ======================================================= */
const createPrintQR = async (productCode) => {
  if (!productCode) {
    return "";
  }

  try {
    const svg = await QRCode.toString(
      String(productCode),
      {
        type: "svg",
        errorCorrectionLevel: "L",
        margin: 0,
        color: {
          dark: "#000000",
          light: "#ffffff",
        },
      }
    );

    const parser = new DOMParser();

    const parsed =
      parser.parseFromString(
        svg,
        "image/svg+xml"
      );

    const svgElement =
      parsed.documentElement;

    /*
     * IMPORTANT:
     *
     * Keep the ORIGINAL QR SVG viewBox.
     *
     * Do NOT rebuild the QR using
     * viewBox="0 0 100 100".
     */

    svgElement.setAttribute(
      "class",
      "print-qr"
    );

    svgElement.setAttribute(
      "preserveAspectRatio",
      "xMidYMid meet"
    );

    svgElement.setAttribute(
      "aria-hidden",
      "true"
    );

    /*
     * Remove generated physical dimensions.
     * CSS will control the exact mm size.
     */

    svgElement.removeAttribute(
      "width"
    );

    svgElement.removeAttribute(
      "height"
    );

    return svgElement.outerHTML;

  } catch (error) {

    console.error(
      "Print QR generation failed:",
      error
    );

    return "";
  }
};


  /* =======================================================
     BUILD ONE PRINT LABEL
  ======================================================= */

  const buildPrintLabel =
    async (
      product,
      config
    ) => {
      /*
       * VERY IMPORTANT:
       *
       * QR VALUE = PRODUCT CODE ONLY
       */
      const productCode = getProductCode(product);
      if (!productCode) {
        console.warn("Skipping QR label: productCode is missing.", product?.id);
        return "";
      }

      const skuOrCode = getProductSkuOrCode(product);
      const qr = await createPrintQR(productCode);
      const productPrice = formatLabelPrice(product);
      const compareAtPrice = formatCompareAtPrice(product);
      const discount = formatDiscount(product);

      return `
        <div
          class="print-label"
          data-product-code="${escapeHtml(
            productCode
          )}"
        >

          <!-- ============================
               QR
          ============================= -->

         ${qr}


          <!-- SKU is printed across the full label width at the bottom. -->
          <div class="print-product-sku-bottom" title="${escapeHtml(getProductSku(product) || getProductCode(product))}">
            ${escapeHtml(getProductSku(product) || getProductCode(product) || "-")}
          </div>

          <div class="print-product-code">
            ${escapeHtml(getProductCodeLabel(product))}
          </div>

          ${compareAtPrice ? `<div class="print-product-compare">${escapeHtml(compareAtPrice)}</div>` : ""}

          <div class="print-product-price">
            ${escapeHtml(productPrice)}
          </div>

          ${discount ? `<div class="print-product-discount">${escapeHtml(discount)}</div>` : ""}

        </div>
      `;
    };


  /* =======================================================
     PRINT
  ======================================================= */

  const handlePrint =
    async () => {
      if (
        printableProducts.length ===
        0
      ) {
        alert(
          "Please select at least one product."
        );

        return;
      }

      const config =
        currentPrintConfig;

      /*
       * Open popup immediately.
       */
      const printWindow =
        window.open(
          "",
          "_blank",
          "width=700,height=900"
        );

      if (!printWindow) {
        alert(
          "Please allow pop-ups for printing."
        );

        return;
      }


      /* =====================================================
         GENERATE LABELS
      ===================================================== */

      const labels = [];

      for (
        const product of printableProducts
      ) {
        const html =
          await buildPrintLabel(
            product,
            config
          );

        if (html) {
          labels.push(html);
        }
      }

      const labelsHTML =
        labels.join("");


      /* =====================================================
         PRINT WINDOW
      ===================================================== */

      printWindow.document.open();

      printWindow.document.write(`
        <!DOCTYPE html>

        <html>

          <head>

            <meta
              charset="UTF-8"
            />

            <meta
              name="viewport"
              content="width=device-width, initial-scale=1"
            />

            <title>
              QR Labels
            </title>


            <style>

              /* =================================================
                 EXACT PAGE SIZE
              ================================================= */

              @page {

                size:
                  ${config.width}mm
                  ${config.height}mm;

                margin:
                  0 !important;

              }


              /* =================================================
                 GLOBAL RESET
              ================================================= */

              *,
              *::before,
              *::after {

                box-sizing:
                  border-box !important;

              }


              html {

                width:
                  ${config.width}mm !important;

                min-width:
                  ${config.width}mm !important;

                max-width:
                  ${config.width}mm !important;

                height:
                  ${config.height}mm !important;

                margin:
                  0 !important;

                padding:
                  0 !important;

              }


              body {

                width:
                  ${config.width}mm !important;

                min-width:
                  ${config.width}mm !important;

                max-width:
                  ${config.width}mm !important;

                height:
                  ${config.height}mm !important;

                margin:
                  0 !important;

                padding:
                  0 !important;

                background:
                  #ffffff !important;

                font-family:
                  Arial,
                  Helvetica,
                  sans-serif !important;

                overflow:
                  hidden !important;

              }


              /* =================================================
                 ONE LABEL
              ================================================= */

              .print-label {

                position:
                  relative !important;

                width:
                  ${config.width}mm !important;

                min-width:
                  ${config.width}mm !important;

                max-width:
                  ${config.width}mm !important;

                height:
                  ${config.height}mm !important;

                min-height:
                  ${config.height}mm !important;

                max-height:
                  ${config.height}mm !important;

                margin:
                  0 !important;

                padding:
                  0 !important;

                background:
                  #ffffff !important;

                overflow:
                  hidden !important;

                page-break-after:
                  always !important;

                break-after:
                  page !important;

                transform:
                  none !important;

              }


              .print-label:last-child {

                page-break-after:
                  auto !important;

                break-after:
                  auto !important;

              }


              /* =================================================
                 QR CODE

                 47.5 × 25:
                 LEFT = 3mm
                 TOP  = 4mm
                 SIZE = 14.8mm

                 32.5 × 18:
                 LEFT = 1.8mm
                 TOP  = 3mm
                 SIZE = 10.5mm
              ================================================= */

              .print-qr {

  position:
    absolute !important;

  left:
    ${config.qrLeft}mm !important;

  top:
    ${config.qrTop}mm !important;

  width:
    ${config.qrSize}mm !important;

  height:
    ${config.qrSize}mm !important;

  min-width:
    ${config.qrSize}mm !important;

  min-height:
    ${config.qrSize}mm !important;

  max-width:
    ${config.qrSize}mm !important;

  max-height:
    ${config.qrSize}mm !important;

  display:
    block !important;

  margin:
    0 !important;

  padding:
    0 !important;

  overflow:
    visible !important;

  transform:
    none !important;

  transform-origin:
    center center !important;

  shape-rendering:
    crispEdges !important;
}

              .print-qr rect,
              .print-qr path {

                shape-rendering:
                  crispEdges !important;

              }


              /* =================================================
                 PRODUCT NAME

                 NO ROTATION.

                 Your physical PRN output is upright, so
                 rotating the HTML by 180 degrees is incorrect.
              ================================================= */

              .print-product-name {

                position:
                  absolute !important;

                left:
                  ${config.textLeft}mm !important;

                top:
                  ${config.titleTop}mm !important;

                width:
                  ${config.textWidth}mm !important;

                height:
                  3.2mm !important;

                margin:
                  0 !important;

                padding:
                  0 !important;

                text-align:
                  left !important;

                font-family:
                  Arial,
                  Helvetica,
                  sans-serif !important;

                font-size:
                  ${config.titleFont}pt !important;

                font-weight:
                  bold !important;

                line-height:
                  1 !important;

                white-space:
                  nowrap !important;

                overflow:
                  hidden !important;

                overflow-wrap:
                  normal !important;

                display:
                  block !important;

                text-overflow:
                  ellipsis !important;

                transform:
                  none !important;

              }


              /* SKU: full-width bottom line, below QR and pricing content */
              .print-product-sku-bottom {
                position: absolute !important;
                left: 1mm !important;
                right: 1mm !important;
                bottom: 0.5mm !important;
                width: calc(100% - 2mm) !important;
                height: 2.6mm !important;
                margin: 0 !important;
                padding: 0 !important;
                display: block !important;
                text-align: center !important;
                font-family: Arial, Helvetica, sans-serif !important;
                font-size: 5pt !important;
                font-weight: bold !important;
                line-height: 1 !important;
                white-space: nowrap !important;
                overflow: hidden !important;
                text-overflow: ellipsis !important;
                box-sizing: border-box !important;
                z-index: 5 !important;
              }

              .print-product-name.print-product-sku {
                display: none !important;
              }

              /* =================================================
                 SUBCOLLECTION
              ================================================= */

              .print-subcollection {
                display: none !important;
                position:
                  absolute !important;

                left:
                  ${config.textLeft}mm !important;

                top:
                  ${config.subTop}mm !important;

                width:
                  ${config.textWidth}mm !important;

                height:
                  3.5mm !important;

                margin:
                  0 !important;

                padding:
                  0 !important;

                text-align:
                  left !important;

                font-family:
                  Arial,
                  Helvetica,
                  sans-serif !important;

                font-size:
                  ${config.subFont}pt !important;

                font-weight:
                  normal !important;

                line-height:
                  1 !important;

                white-space:
                  nowrap !important;

                overflow:
                  hidden !important;

                text-overflow:
                  ellipsis !important;

                transform:
                  none !important;

              }


              /* =================================================
                 PRODUCT CODE
              ================================================= */

              .print-product-code {
                display: block !important;
                position:
                  absolute !important;

                left:
                  ${config.textLeft}mm !important;

                top:
                  ${config.codeTop}mm !important;

                width:
                  ${config.textWidth}mm !important;

                height:
                  4mm !important;

                margin:
                  0 !important;

                padding:
                  0 !important;

                text-align:
                  left !important;

                font-family:
                  Arial,
                  Helvetica,
                  sans-serif !important;

                font-size:
                  ${config.codeFont}pt !important;

                font-weight:
                  normal !important;

                line-height:
                  1 !important;

                white-space:
                  nowrap !important;

                overflow:
                  hidden !important;

                text-overflow:
                  ellipsis !important;

                transform:
                  none !important;

              }


              /* =================================================
                 PRINT MEDIA
              ================================================= */

                             .print-product-code {
  position: absolute !important;
  left: ${config.textLeft}mm !important;
  top: ${config.codeTop}mm !important;
  width: ${config.textWidth}mm !important;
  height: 2.8mm !important;
  margin: 0 !important;
  padding: 0 !important;
  text-align: left !important;
  font-family: Arial, Helvetica, sans-serif !important;
  font-size: ${config.height <= 18 ? 3.7 : 5.0}pt !important;
  font-weight: normal !important;
  line-height: 1 !important;
  white-space: nowrap !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
}

.print-product-compare {
  position: absolute !important;
  left: ${config.textLeft}mm !important;
  top: ${config.compareTop}mm !important;
  width: ${config.textWidth}mm !important;
  height: 3mm !important;
  margin: 0 !important;
  padding: 0 !important;
  text-align: left !important;
  font-family: Arial, Helvetica, sans-serif !important;
  font-size: ${config.subFont}pt !important;
  font-weight: normal !important;
  line-height: 1 !important;
  white-space: nowrap !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  text-decoration: line-through !important;
  color: #64748b !important;
}

.print-product-price {
  position: absolute !important;
  left: ${config.textLeft}mm !important;
  top: ${config.priceTop}mm !important;
  width: ${config.textWidth}mm !important;
  height: 3mm !important;
  margin: 0 !important;
  padding: 0 !important;
  text-align: left !important;
  font-family: Arial, Helvetica, sans-serif !important;
  font-size: ${config.codeFont}pt !important;
  font-weight: bold !important;
  line-height: 1 !important;
  white-space: nowrap !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
}

.print-product-discount {
  position: absolute !important;
  left: ${config.textLeft}mm !important;
  top: ${config.discountTop}mm !important;
  width: ${config.textWidth}mm !important;
  height: 3mm !important;
  margin: 0 !important;
  padding: 0 !important;
  text-align: left !important;
  font-family: Arial, Helvetica, sans-serif !important;
  font-size: ${config.subFont}pt !important;
  font-weight: bold !important;
  line-height: 1 !important;
  white-space: nowrap !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  color: #166534 !important;
}

@media print {

                @page {

                  size:
                    ${config.width}mm
                    ${config.height}mm !important;

                  margin:
                    0 !important;

                }


                html,
                body {

                  width:
                    ${config.width}mm !important;

                  height:
                    ${config.height}mm !important;

                  margin:
                    0 !important;

                  padding:
                    0 !important;

                }


                .print-label {

                  width:
                    ${config.width}mm !important;

                  height:
                    ${config.height}mm !important;

                  margin:
                    0 !important;

                  padding:
                    0 !important;

                }


                /*
                 * Prevent browser from adding
                 * any unwanted scaling.
                 */

                .print-qr,
                .print-product-name,
                .print-subcollection,
                .print-product-code {

                  print-color-adjust:
                    exact !important;

                  -webkit-print-color-adjust:
                    exact !important;

                }

              }

            </style>

          </head>


          <body>

            ${labelsHTML}

          </body>

        </html>
      `);

      printWindow.document.close();


      /* =====================================================
         WAIT FOR QR + DOM
      ===================================================== */

      const waitForPrint =
        () => {

          try {

            printWindow.focus();

            printWindow.print();

          } catch (error) {

            console.error(
              "Printing failed:",
              error
            );

          }

        };


      /*
       * Give Chrome enough time to
       * finish rendering all SVG QR codes.
       */
      setTimeout(
        waitForPrint,
        900
      );


      printWindow.onafterprint = async () => {
        // Browser fires afterprint even if cancelled, so confirm before saving quantities.
        const printedSuccessfully = window.confirm("Did the labels print successfully? Select OK to save these quantities to Firebase, or Cancel to leave them pending.");
        if (printedSuccessfully) {
          const countsToAdd = {};
          printableProducts.forEach((product) => {
            const key = getPrintTrackingKey(product);
            countsToAdd[key] = (countsToAdd[key] || 0) + 1;
          });
          setIsSavingPrintHistory(true);
          try {
            const updates = Object.entries(countsToAdd).map(async ([key, count]) => {
              const product = products.find((item) => getPrintTrackingKey(item) === key);
              const stock = product ? getProductStock(product) : Number.MAX_SAFE_INTEGER;
              const nextCount = Math.min(stock, Number(printedCounts[key] || 0) + count);
              // encodeURIComponent keeps the composite product key safe as a Firestore document ID.
              const historyDocId = encodeURIComponent(key);
              await setDoc(doc(db, "barcodePrintHistory", historyDocId), {
                trackingKey: key,
                collectionId: product?.collectionId || "",
                subcollectionId: product?.subcollectionId || "",
                destination: product?.destination || "",
                productDocumentId: product?.productDocumentId || product?.id || "",
                productCode: getProductCode(product),
                productName: product?.productName || product?.name || "",
                stockQuantity: stock,
                printedQuantity: nextCount,
                updatedAt: serverTimestamp(),
              }, { merge: true });
              return [key, nextCount];
            });
            const savedCounts = await Promise.all(updates);
            setPrintedCounts((previous) => {
              const next = { ...previous };
              savedCounts.forEach(([key, count]) => { next[key] = count; });
              return next;
            });
            setSelectedProductIds([]);
            setProductQuantities({});
            setPrintStatusFilter("not-printed");
          } catch (error) {
            console.error("Failed to save barcode print history to Firebase:", error);
            alert("The labels may have printed, but Firebase could not save the print history. Check your connection and Firestore rules, then retry or reconcile the printed quantity.");
          } finally {
            setIsSavingPrintHistory(false);
          }
        }
        setTimeout(() => {
          try { printWindow.close(); } catch (error) { console.error(error); }
        }, 300);
      };
    };


  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <div className="admin-page">

      {/* =================================================
          TITLE
      ================================================= */}

      <div className="product-title">

        <h1>
          Barcode / QR Printing
        </h1>

      </div>


      {/* =================================================
          COLLECTION
      ================================================= */}

      <div className="form-group">

        <label>
          Collection
        </label>

        <select
          value={
            selectedCollectionId
          }
          onChange={(e) => {

            setSelectedCollectionId(
              e.target.value
            );

            setProducts([]);

            setSelectedProductIds([]);

            setProductQuantities({});

          }}
        >

          <option value="">
            Select Collection
          </option>

          {collections.map(
            (collectionItem) => (

              <option
                key={
                  collectionItem.id
                }
                value={
                  collectionItem.id
                }
              >

                {
                  collectionItem.title ||
                  collectionItem.name ||
                  collectionItem.id
                }

              </option>

            )
          )}

        </select>

      </div>


      {/* Product code search applies to all products in the selected collection. */}

{selectedCollectionId && (
  <div className="form-group">
    <label>
      Search Product Code
    </label>

    <input
      type="text"
      value={productCodeSearch}
      onChange={(e) =>
        setProductCodeSearch(e.target.value)
      }
      placeholder="Search by product code..."
      style={{
        width: "100%",
        padding: "10px 12px",
        border: "1px solid #d1d5db",
        borderRadius: "8px",
        fontSize: "14px",
        outline: "none",
      }}
    />
  </div>
)}
      <div className="barcode-print-status-filter">
        <label htmlFor="barcode-print-status">Print status</label>
        <select id="barcode-print-status" value={printStatusFilter} onChange={(e) => { setPrintStatusFilter(e.target.value); setSelectedProductIds([]); setProductQuantities({}); }}>
          <option value="not-printed">Not printed</option>
          <option value="partial">Partially printed</option>
          <option value="printed">Already printed (full quantity)</option>
          <option value="all">All products</option>
        </select>
        <span>Print history is saved in this browser.</span>
      </div>

      {/* =================================================
          PRODUCTS
      ================================================= */}

      <div className="admin-section">

        <h3>
          Products
        </h3>


        <div className="product-actions-bar">

          <button
            type="button"
            onClick={
              selectAllProducts
            }
            disabled={
              products.length === 0
            }
          >
            Select All
          </button>


          <button
            type="button"
            onClick={
              clearAllProducts
            }
            disabled={
              selectedProductIds.length ===
              0
            }
          >
            Clear All
          </button>


          <span className="selected-count">

            Selected:{" "}

            {
              selectedProductIds.length
            }

          </span>


          <span className="selected-count">

            Labels:{" "}

            {totalLabelCount}

          </span>

        </div>


        <div className="product-grid">

          {products.length === 0 && (

            <div
              style={{
                padding: "20px",
                color: "#6b7280",
              }}
            >

              {isProductsLoading ? "Loading products from all subcollections…" : (selectedCollectionId ? "No products found in this collection." : "Select a collection to load its products.")}

            </div>

          )}


          {productsForDisplay.map(
            (product) => {

              const selected =
                selectedProductIds.includes(
                  product.id
                );

              const stockQuantity = getProductStock(product);
              const printedQuantity = getPrintedCount(product);
              const remainingQuantity = Math.max(0, stockQuantity - printedQuantity);
              const quantity = productQuantities[product.id] ?? remainingQuantity;
              const printStatus = stockQuantity > 0 && printedQuantity >= stockQuantity ? "Already printed" : printedQuantity > 0 ? `Partially printed (${printedQuantity}/${stockQuantity})` : "Not printed";


              return (

                <div
                  key={
                    product.id
                  }

                  className={
                    `barcodeproduct-card ${
                      selected
                        ? "selected"
                        : ""
                    }`
                  }

                  onClick={() =>
                    toggleProduct(
                      product.id
                    )
                  }
                >

                  <input
                    type="checkbox"

                    checked={
                      selected
                    }

                    onChange={() =>
                      toggleProduct(
                        product.id
                      )
                    }

                    onClick={(e) =>
                      e.stopPropagation()
                    }
                  />


                  <div
                    style={{
                      flex: 1,
                      minWidth: 0,
                    }}
                  >

                    <strong>

                      {
                        product.productName ||
                        product.name ||
                        "Unnamed Product"
                      }


                      {isNewProduct(
                        product
                      ) && (

                        <span className="new-badge">
                          NEW
                        </span>

                      )}

                    </strong>



                    <small>

                      Code:{" "}

                      {
                        product.productCode ||
                        "-"
                      }

                    </small>

                    <small className={`barcode-print-status ${remainingQuantity === 0 ? "is-printed" : printedQuantity > 0 ? "is-partial" : "is-unprinted"}`}>
                      {printStatus}
                    </small>
                    <small className="barcode-remaining-count">
                      Remaining labels: {remainingQuantity}
                    </small>

                    <small
                      style={{
                        display: "block",
                        marginTop: "4px",
                        color: "#9ca3af",
                        wordBreak:
                          "break-all",
                      }}
                    >

                      ID:{" "}

                      {
                        product.id
                      }

                    </small>


                    {selected && (

                      <div
                        style={{
                          display: "flex",
                          alignItems:
                            "center",
                          gap: "8px",
                          marginTop:
                            "10px",
                        }}
                      >

                        <span
                          style={{
                            fontSize:
                              "12px",
                            fontWeight:
                              "600",
                          }}
                        >
                          Quantity
                        </span>


                        <input
                          type="number"

                          min="1"

                          step="1"

                          value={
                            quantity
                          }

                          onClick={(e) =>
                            e.stopPropagation()
                          }

                          onChange={(e) => {

                            const value = Math.min(
                              remainingQuantity,
                              Math.max(0, parseInt(e.target.value, 10) || 0)
                            );

                            setProductQuantities(
                              (previous) => ({
                                ...previous,

                                [product.id]:
                                  value,
                              })
                            );

                          }}

                          style={{
                            width: "70px",
                            padding:
                              "5px 7px",
                            border:
                              "1px solid #d1d5db",
                            borderRadius:
                              "5px",
                          }}
                        />

                      </div>

                    )}

                  </div>

                </div>

              );

            }
          )}

        </div>

      </div>


      {/* =================================================
          PRINT FORMAT
      ================================================= */}

      <div className="admin-section">

        <h3>
          Print Format
        </h3>


        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "20px",
            alignItems: "center",
          }}
        >

          {/* ============================================
              47.5 × 25
          ============================================= */}

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "7px",
              cursor: "pointer",
            }}
          >

            <input
              type="radio"

              name="print-layout"

              value="THERMAL_47_5X25"

              checked={
                printLayout ===
                "THERMAL_47_5X25"
              }

              onChange={() =>
                setPrintLayout(
                  "THERMAL_47_5X25"
                )
              }
            />

            <span>
              47.5 × 25 mm
            </span>

          </label>


          {/* ============================================
              32.5 × 18
          ============================================= */}

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "7px",
              cursor: "pointer",
            }}
          >

            <input
              type="radio"

              name="print-layout"

              value="THERMAL_32_5X18"

              checked={
                printLayout ===
                "THERMAL_32_5X18"
              }

              onChange={() =>
                setPrintLayout(
                  "THERMAL_32_5X18"
                )
              }
            />

            <span>
              32.5 × 18 mm
            </span>

          </label>

        </div>


        {/* =============================================
            FORMAT INFORMATION
        ============================================== */}

        <div
          style={{
            marginTop: "14px",
            padding:
              "10px 12px",
            background:
              "#f3f4f6",
            borderRadius:
              "6px",
            fontSize: "13px",
            color: "#374151",
          }}
        >

          <strong>
            QR:
          </strong>{" "}

          Product code only

          {" • "}

          Error correction: L

          {" • "}

          Physical orientation: upright

        </div>

      </div>


      {/* =================================================
          PRINT BUTTON
      ================================================= */}

      <button
        type="button"

        className="primary-btn"

        disabled={
          totalLabelCount === 0 || isPrintHistoryLoading || isSavingPrintHistory
        }

        onClick={
          handlePrint
        }
      >

        {isPrintHistoryLoading ? "Loading Firebase print history…" : isSavingPrintHistory ? "Saving print history to Firebase…" : "🖨️ Print QR Labels"}

        {totalLabelCount > 0 && !isPrintHistoryLoading && !isSavingPrintHistory && (

          <>
            {" "}
            (
            {totalLabelCount}
            )
          </>

        )}

      </button>


      {/* =================================================
          SCREEN PREVIEW
      ================================================= */}

      <div
        ref={pdfRef}

        className={
          `print-area ${
            printLayout ===
            "THERMAL_47_5X25"
              ? "thermal-47-5-25"
              : "thermal-32-5-18"
          }`
        }
      >

        {printableProducts.map(
          (
            product,
            index
          ) => (

            <BarcodeLabel

              key={
                `${product.id}-${index}`
              }

              product={
                product
              }

              printLayout={
                printLayout
              }

            />

          )
        )}

      </div>

    </div>
  );
};


export default BarcodePrintingPage;