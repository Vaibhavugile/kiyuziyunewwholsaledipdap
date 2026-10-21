import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  query,
  where,
  db,
} from "../firebase";
import { Timestamp } from "firebase/firestore";
import "./AdminDailyOrders.css";

const DEFAULT_CHECKS = [
  "Order Confirmed",
  "Payment Verified",
  "Packed",
  "Dispatched",
];

const CHECKLIST_SETTINGS_DOC = "dailyOrderChecklist";

const getLocalDateKey = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

const getDateObject = (timestamp) => {
  if (!timestamp) return null;

  if (typeof timestamp.toDate === "function") {
    return timestamp.toDate();
  }

  if (timestamp instanceof Date) {
    return timestamp;
  }

  if (typeof timestamp === "object" && timestamp.seconds != null) {
    return new Date(Number(timestamp.seconds) * 1000);
  }

  const date = new Date(timestamp);

  return Number.isNaN(date.getTime()) ? null : date;
};

const getDateRange = (dateKey) => {
  const [year, month, day] = dateKey.split("-").map(Number);

  const start = new Date(year, month - 1, day, 0, 0, 0, 0);
  const end = new Date(year, month - 1, day + 1, 0, 0, 0, 0);

  return {
    startTimestamp: Timestamp.fromDate(start),
    endTimestamp: Timestamp.fromDate(end),
  };
};

const formatDisplayDate = (dateString) => {
  if (!dateString) return "";

  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
};

const AdminDailyOrders = () => {
  const [orders, setOrders] = useState([]);
  const [storeOrders, setStoreOrders] = useState([]);
  const [sellers, setSellers] = useState({});
  const [subcollectionsMap, setSubcollectionsMap] = useState({});

  // Local date is used so "today" does not shift because of UTC conversion.
  const [selectedDate, setSelectedDate] = useState(getLocalDateKey());

  const [checkLabels, setCheckLabels] = useState(DEFAULT_CHECKS);
  const [checkValues, setCheckValues] = useState({});
  const [savingExclude, setSavingExclude] = useState(null);

  const [loading, setLoading] = useState(true);
  const [savingCheck, setSavingCheck] = useState(null);

  const [showChecklistSettings, setShowChecklistSettings] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  /*
   * ------------------------------------------------------------
   * LOAD CHECKLIST SETTINGS
   * This is only one small settings document, not order data.
   * ------------------------------------------------------------
   */
  // Load purchase rates used by the existing ReportPage profit logic.
  useEffect(() => {
    const loadPurchaseRates = async () => {
      try {
        const collectionsSnap = await getDocs(collection(db, "collections"));
        const rateMap = {};

        await Promise.all(
          collectionsSnap.docs.map(async (collectionDoc) => {
            const subSnap = await getDocs(
              collection(db, "collections", collectionDoc.id, "subcollections")
            );
            subSnap.docs.forEach((subDoc) => {
              const data = subDoc.data();
              rateMap[subDoc.id] = {
                purchaseRate: Number(data.purchaseRate || 0),
                name: data.name || "",
              };
            });
          })
        );

        setSubcollectionsMap(rateMap);
      } catch (error) {
        console.error("Failed to load purchase rates:", error);
      }
    };

    loadPurchaseRates();
  }, []);

  useEffect(() => {
    const loadChecklistSettings = async () => {
      try {
        const settingsRef = doc(
          db,
          "settings",
          CHECKLIST_SETTINGS_DOC
        );

        const snapshot = await getDoc(settingsRef);

        if (snapshot.exists()) {
          const data = snapshot.data();

          if (
            Array.isArray(data.checkLabels) &&
            data.checkLabels.length === 4
          ) {
            setCheckLabels(data.checkLabels);
          }
        }
      } catch (error) {
        console.error("Failed to load checklist settings:", error);
      }
    };

    loadChecklistSettings();
  }, []);

  /*
   * ------------------------------------------------------------
   * LOAD ONLY THE SELECTED DAY
   *
   * IMPORTANT:
   * We do NOT do:
   *   getDocs(collection(db, "orders"))
   *   getDocs(collection(db, "storeOrders"))
   *
   * Instead Firestore receives a createdAt date range.
   * ------------------------------------------------------------
   */
  useEffect(() => {
    let active = true;

    const loadDataForDate = async () => {
      setLoading(true);
      setOrders([]);
      setStoreOrders([]);
      setCheckValues({});

      try {
        const { startTimestamp, endTimestamp } =
          getDateRange(selectedDate);

        const ordersQuery = query(
          collection(db, "orders"),
          where("createdAt", ">=", startTimestamp),
          where("createdAt", "<", endTimestamp)
        );

        const storeOrdersQuery = query(
          collection(db, "storeOrders"),
          where("createdAt", ">=", startTimestamp),
          where("createdAt", "<", endTimestamp)
        );

        // Both date-range queries can run together.
        const [ordersSnapshot, storeOrdersSnapshot] =
          await Promise.all([
            getDocs(ordersQuery),
            getDocs(storeOrdersQuery),
          ]);

        if (!active) return;

        const ordersList = ordersSnapshot.docs
          .map((orderDoc) => ({
            id: orderDoc.id,
            ...orderDoc.data(),
            orderType: "order",
          }))
          .filter(
            (order) =>
              String(order.status || "").toLowerCase() !==
              "cancelled"
          )
          .sort((a, b) => {
            const dateA =
              getDateObject(a.createdAt)?.getTime() || 0;
            const dateB =
              getDateObject(b.createdAt)?.getTime() || 0;

            return dateB - dateA;
          });

        const storeOrdersList = storeOrdersSnapshot.docs
          .map((orderDoc) => ({
            id: orderDoc.id,
            ...orderDoc.data(),
            orderType: "storeOrder",
          }))
          .filter(
            (order) =>
              String(order.status || "").toLowerCase() !==
              "cancelled"
          )
          .sort((a, b) => {
            const dateA =
              getDateObject(a.createdAt)?.getTime() || 0;
            const dateB =
              getDateObject(b.createdAt)?.getTime() || 0;

            return dateB - dateA;
          });

        setOrders(ordersList);
        setStoreOrders(storeOrdersList);

        /*
         * Only fetch sellers actually used by today's store orders.
         * Previously the page loaded the complete users collection.
         */
        await loadRequiredSellers(storeOrdersList);

        if (!active) return;

        /*
         * Checklist reads are limited to the orders already returned
         * for the selected day.
         */
        await loadChecklistStates(
          ordersList,
          storeOrdersList,
          selectedDate,
          active
        );
      } catch (error) {
        console.error(
          "Failed to load daily orders:",
          error
        );

        if (active) {
          setOrders([]);
          setStoreOrders([]);
          setCheckValues({});
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    loadDataForDate();

    return () => {
      active = false;
    };
  }, [selectedDate]);

  /*
   * ------------------------------------------------------------
   * LOAD ONLY REQUIRED SELLERS
   * ------------------------------------------------------------
   */
  const loadRequiredSellers = async (storeOrderList) => {
    const sellerIds = [
      ...new Set(
        storeOrderList
          .map((order) => order.sellerId)
          .filter(Boolean)
      ),
    ];

    if (sellerIds.length === 0) {
      return;
    }

    const missingSellerIds = sellerIds.filter(
      (sellerId) => !sellers[sellerId]
    );

    if (missingSellerIds.length === 0) {
      return;
    }

    try {
      const sellerResults = await Promise.all(
        missingSellerIds.map(async (sellerId) => {
          try {
            const sellerRef = doc(db, "users", sellerId);
            const sellerSnapshot = await getDoc(sellerRef);

            if (!sellerSnapshot.exists()) {
              return [
                sellerId,
                {
                  id: sellerId,
                  storeName: "Unknown Seller",
                },
              ];
            }

            return [
              sellerId,
              {
                id: sellerSnapshot.id,
                ...sellerSnapshot.data(),
              },
            ];
          } catch (error) {
            console.error(
              `Failed to load seller ${sellerId}:`,
              error
            );

            return [
              sellerId,
              {
                id: sellerId,
                storeName: "Unknown Seller",
              },
            ];
          }
        })
      );

      setSellers((previous) => ({
        ...previous,
        ...Object.fromEntries(sellerResults),
      }));
    } catch (error) {
      console.error("Failed to load required sellers:", error);
    }
  };

  /*
   * ------------------------------------------------------------
   * LOAD CHECKBOX STATES
   *
   * Only today's already-filtered orders are checked.
   * Historical orders are never touched.
   * ------------------------------------------------------------
   */
  const loadChecklistStates = async (
    normalOrders,
    storeOrderList,
    dateKey,
    isActive
  ) => {
    try {
      const allOrders = [
        ...normalOrders,
        ...storeOrderList,
      ];

      if (allOrders.length === 0) {
        if (isActive) {
          setCheckValues({});
        }
        return;
      }

      const states = {};

      await Promise.all(
        allOrders.map(async (order) => {
          const docId = `${dateKey}_${order.orderType}_${order.id}`;

          const checkRef = doc(
            db,
            "dailyOrderChecks",
            docId
          );

          try {
            const checkSnapshot = await getDoc(checkRef);

            if (checkSnapshot.exists()) {
              const data = checkSnapshot.data();

              states[docId] = {
                ...(data.checks || {}),
                profitExcluded: data.profitExcluded === true,
              };
            } else {
              states[docId] = {};
            }
          } catch (error) {
            console.error(
              `Failed to load checklist for ${docId}:`,
              error
            );

            states[docId] = {};
          }
        })
      );

      if (isActive) {
        setCheckValues(states);
      }
    } catch (error) {
      console.error(
        "Failed to load checklist states:",
        error
      );
    }
  };

  /*
   * ------------------------------------------------------------
   * CHECKBOX HANDLER
   * ------------------------------------------------------------
   */
  const handleCheckChange = async (
    order,
    checkIndex,
    checked
  ) => {
    const docId = `${selectedDate}_${order.orderType}_${order.id}`;

    const previousChecks = checkValues[docId] || {};

    const updatedChecks = {
      ...previousChecks,
      [`check${checkIndex + 1}`]: checked,
    };

    // Update UI immediately.
    setCheckValues((previous) => ({
      ...previous,
      [docId]: updatedChecks,
    }));

    const savingKey = `${docId}_${checkIndex}`;

    setSavingCheck(savingKey);

    try {
      const checkRef = doc(
        db,
        "dailyOrderChecks",
        docId
      );

      await setDoc(
        checkRef,
        {
          date: selectedDate,
          orderId: order.id,
          orderType: order.orderType,
          checks: updatedChecks,
          updatedAt: Date.now(),
        },
        {
          merge: true,
        }
      );
    } catch (error) {
      console.error(
        "Failed to save checklist:",
        error
      );

      // Revert the UI if saving failed.
      setCheckValues((previous) => ({
        ...previous,
        [docId]: previousChecks,
      }));
    } finally {
      setSavingCheck(null);
    }
  };

  /*
   * ------------------------------------------------------------
   * EXCLUDE ORDER FROM PROFIT
   *
   * This does NOT delete or cancel the order. It only excludes
   * the order's profit from the Daily Orders profit totals.
   * The choice is saved with the existing dailyOrderChecks doc
   * so it remains selected when the date is opened again.
   * ------------------------------------------------------------
   */
  const handleProfitExcludeChange = async (order, excluded) => {
    const docId = `${selectedDate}_${order.orderType}_${order.id}`;
    const previousState = checkValues[docId] || {};

    const updatedState = {
      ...previousState,
      profitExcluded: excluded,
    };

    setCheckValues((previous) => ({
      ...previous,
      [docId]: updatedState,
    }));

    setSavingExclude(docId);

    try {
      const checkRef = doc(
        db,
        "dailyOrderChecks",
        docId
      );

      await setDoc(
        checkRef,
        {
          date: selectedDate,
          orderId: order.id,
          orderType: order.orderType,
          profitExcluded: excluded,
          updatedAt: Date.now(),
        },
        {
          merge: true,
        }
      );
    } catch (error) {
      console.error(
        "Failed to save profit exclusion:",
        error
      );

      setCheckValues((previous) => ({
        ...previous,
        [docId]: previousState,
      }));
    } finally {
      setSavingExclude(null);
    }
  };

  /*
   * ------------------------------------------------------------
   * CHECKLIST SETTINGS
   * ------------------------------------------------------------
   */
  const handleCheckLabelChange = (index, value) => {
    setCheckLabels((previous) => {
      const updated = [...previous];
      updated[index] = value;
      return updated;
    });
  };

  const saveChecklistSettings = async () => {
    setSavingSettings(true);

    try {
      const cleanedLabels = checkLabels.map(
        (label, index) =>
          String(label || "").trim() ||
          `Check ${index + 1}`
      );

      await setDoc(
        doc(
          db,
          "settings",
          CHECKLIST_SETTINGS_DOC
        ),
        {
          checkLabels: cleanedLabels,
          updatedAt: Date.now(),
        },
        {
          merge: true,
        }
      );

      setCheckLabels(cleanedLabels);
      setShowChecklistSettings(false);
    } catch (error) {
      console.error(
        "Failed to save checklist settings:",
        error
      );
    } finally {
      setSavingSettings(false);
    }
  };

  /*
   * ------------------------------------------------------------
   * DATE NAVIGATION
   * ------------------------------------------------------------
   */
  const changeDate = (days) => {
    const [year, month, day] =
      selectedDate.split("-").map(Number);

    const date = new Date(
      year,
      month - 1,
      day
    );

    date.setDate(date.getDate() + days);

    setSelectedDate(getLocalDateKey(date));
  };

  const goToToday = () => {
    setSelectedDate(getLocalDateKey());
  };

  /*
   * ------------------------------------------------------------
   * DATA IS ALREADY DATE-FILTERED BY FIRESTORE.
   *
   * These useMemo calls only remove cancelled orders as a final
   * safety check and sort the small result set.
   * ------------------------------------------------------------
   */
  const filteredOrders = useMemo(() => {
    return orders
      .filter(
        (order) =>
          String(order.status || "").toLowerCase() !==
          "cancelled"
      )
      .sort((a, b) => {
        const dateA =
          getDateObject(a.createdAt)?.getTime() || 0;
        const dateB =
          getDateObject(b.createdAt)?.getTime() || 0;

        return dateB - dateA;
      });
  }, [orders]);

  const filteredStoreOrders = useMemo(() => {
    return storeOrders
      .filter(
        (order) =>
          String(order.status || "").toLowerCase() !==
          "cancelled"
      )
      .sort((a, b) => {
        const dateA =
          getDateObject(a.createdAt)?.getTime() || 0;
        const dateB =
          getDateObject(b.createdAt)?.getTime() || 0;

        return dateB - dateA;
      });
  }, [storeOrders]);

  /*
   * ------------------------------------------------------------
   * NORMAL ORDER PROFIT
   * Use the profit already stored on the order at checkout.
   * orderProfit/grossProfit is based on purchaseRateAtOrder.
   * ------------------------------------------------------------
   */
  const calculateNormalOrderProfit = (order) => {
    if (order.orderProfit !== undefined && order.orderProfit !== null) {
      return Number(order.orderProfit || 0);
    }

    if (order.grossProfit !== undefined && order.grossProfit !== null) {
      return Number(order.grossProfit || 0);
    }

    return (order.items || []).reduce((total, item) => {
      const purchaseRate = Number(item.purchaseRateAtOrder || item.itemCost || 0);
      const sellingPrice = Number(item.priceAtTimeOfOrder || 0);
      const quantity = Number(item.quantity || 0);
      return total + (sellingPrice - purchaseRate) * quantity;
    }, 0);
  };

  const isProfitExcluded = (order) => {
    const docId = `${selectedDate}_${order.orderType}_${order.id}`;
    return checkValues[docId]?.profitExcluded === true;
  };

  const activeNormalOrders = filteredOrders.filter((order) => !isProfitExcluded(order));
  const activeStoreOrders = filteredStoreOrders.filter((order) => !isProfitExcluded(order));

  const normalProfitTotal = activeNormalOrders.reduce(
    (sum, order) => sum + calculateNormalOrderProfit(order),
    0
  );

  /*
   * ------------------------------------------------------------
   * TOTALS
   * ------------------------------------------------------------
   */
  const normalOrderTotal = activeNormalOrders.reduce(
    (sum, order) => sum + Number(order.totalAmount || 0),
    0
  );

  const storeOrderTotal = activeStoreOrders.reduce(
    (sum, order) => sum + Number(order.totalAmount || 0),
    0
  );

  const totalOrderValue =
    normalOrderTotal + storeOrderTotal;

  /*
   * ------------------------------------------------------------
   * STORE ORDER FINANCIAL CALCULATIONS
   *
   * These follow the same calculation logic used by
   * AdminStoreOrders:
   *
   * Selling Total      = priceAtTimeOfOrder * quantity
   * Seller Cost        = costPrice * quantity
   * Seller Profit      = Selling Total - Seller Cost
   * Admin Order Value  = saved adminPurchaseTotal
   * Our Profit         = saved adminProfit
   * Admin Payable      = Seller Cost + shipping
   * ------------------------------------------------------------
   */
  const calculateStoreOrderFinancials = (order) => {
    let sellerCost = 0;
    let sellingTotal = 0;
    let totalQty = 0;

    (order.items || []).forEach((item) => {
      const qty = Number(item.quantity || 0);

      sellerCost += Number(item.costPrice || 0) * qty;
      sellingTotal +=
        Number(item.priceAtTimeOfOrder || 0) * qty;
      totalQty += qty;
    });

    const sellerProfit = sellingTotal - sellerCost;
    const shipping = Number(order.shippingFee || 0);
    const adminPayable = sellerCost + shipping;

    return {
      orderValue: Number(order.totalAmount || 0),
      sellingTotal,
      sellerCost,
      sellerProfit,
      adminOrderValue: Number(order.adminPurchaseTotal || 0),
      ourProfit: Number(order.adminProfit || 0),
      shipping,
      adminPayable,
      totalQty,
    };
  };

  const storeFinancialTotals = useMemo(() => {
    return activeStoreOrders.reduce(
      (totals, order) => {
        const financials = calculateStoreOrderFinancials(order);

        // An excluded order contributes NOTHING to any financial total.
        totals.orderValue += financials.orderValue;
        totals.adminOrderValue += financials.adminOrderValue;
        totals.sellerProfit += financials.sellerProfit;
        totals.ourProfit += financials.ourProfit;
        totals.adminPayable += financials.adminPayable;
        totals.sellerCost += financials.sellerCost;

        return totals;
      },
      {
        orderValue: 0,
        adminOrderValue: 0,
        sellerProfit: 0,
        ourProfit: 0,
        adminPayable: 0,
        sellerCost: 0,
      }
    );
  }, [activeStoreOrders]);

  const totalDropshipperProfit = Number(storeFinancialTotals.sellerProfit || 0);
  const totalOurProfit =
    Number(normalProfitTotal || 0) +
    Number(storeFinancialTotals.ourProfit || 0);
  const totalBusinessOrderValue =
    Number(normalOrderTotal || 0) +
    Number(storeFinancialTotals.orderValue || 0);

  /*
   * ------------------------------------------------------------
   * GROUP STORE ORDERS BY SELLER

   * ------------------------------------------------------------
   */
  const storeOrdersBySeller = useMemo(() => {
    const groups = {};

    filteredStoreOrders.forEach((order) => {
      const sellerId = order.sellerId || "unknown";

      if (!groups[sellerId]) {
        const seller = sellers[sellerId];

        groups[sellerId] = {
          sellerId,
          sellerName:
            seller?.storeName ||
            seller?.name ||
            seller?.displayName ||
            "Unknown Seller",
          orders: [],
          totals: {
            orderValue: 0,
            adminOrderValue: 0,
            sellerProfit: 0,
            ourProfit: 0,
            adminPayable: 0,
            sellerCost: 0,
            activeOrderCount: 0,
          },
        };
      }

      const financials = calculateStoreOrderFinancials(order);
      const group = groups[sellerId];

      // Keep every order visible, including excluded orders.
      group.orders.push(order);

      // An excluded order contributes NOTHING to any seller total.
      if (!isProfitExcluded(order)) {
        group.totals.activeOrderCount += 1;
        group.totals.orderValue += financials.orderValue;
        group.totals.adminOrderValue +=
          financials.adminOrderValue;
        group.totals.adminPayable += financials.adminPayable;
        group.totals.sellerCost += financials.sellerCost;
        group.totals.sellerProfit += financials.sellerProfit;
        group.totals.ourProfit += financials.ourProfit;
      }
    });

    return Object.values(groups).sort((a, b) =>
      a.sellerName.localeCompare(b.sellerName)
    );
  }, [filteredStoreOrders, sellers, checkValues]);

  const formatMoney = (value) =>
    `₹${Number(value || 0).toLocaleString("en-IN")}`;

  /*
   * ------------------------------------------------------------
   * CHECK STATUS
   * ------------------------------------------------------------
   */
  const getCheckStatus = (order) => {
    const docId = `${selectedDate}_${order.orderType}_${order.id}`;

    return checkValues[docId] || {};
  };

  const renderChecks = (order) => {
    const checks = getCheckStatus(order);

    return checkLabels.map((label, index) => {
      const checkKey = `check${index + 1}`;

      const savingKey =
        `${selectedDate}_${order.orderType}_${order.id}_${index}`;

      return (
        <td
          key={checkKey}
          className="daily-check-cell"
        >
          <label
            className="daily-checkbox"
            title={label}
          >
            <input
              type="checkbox"
              checked={checks[checkKey] === true}
              disabled={savingCheck === savingKey}
              onChange={(event) =>
                handleCheckChange(
                  order,
                  index,
                  event.target.checked
                )
              }
            />

            <span className="checkmark"></span>
          </label>
        </td>
      );
    });
  };

  /*
   * ------------------------------------------------------------
   * ORDER ROW
   * ------------------------------------------------------------
   */
  const renderOrderRow = (order) => {
    const seller = sellers[order.sellerId];

    const sellerName =
      seller?.storeName ||
      seller?.name ||
      seller?.displayName ||
      "Unknown Seller";

    const customerName =
      order.billingInfo?.fullName ||
      order.customerName ||
      order.userName ||
      "Unknown Customer";

    const orderValue = Number(
      order.totalAmount || 0
    ).toLocaleString("en-IN");

    const statusClass = String(
      order.status || "pending"
    )
      .toLowerCase()
      .replace(/\s+/g, "-");

    const excluded = isProfitExcluded(order);
    const excludeSaving = savingExclude === `${selectedDate}_${order.orderType}_${order.id}`;

    return (
      <tr
        key={`${order.orderType}-${order.id}`}
        className={excluded ? "profit-excluded-row" : ""}
      >
        <td className="profit-exclude-cell">
          <label className="profit-exclude-control" title="Exclude this order from profit calculations">
            <input
              type="checkbox"
              checked={excluded}
              disabled={excludeSaving}
              onChange={(event) =>
                handleProfitExcludeChange(order, event.target.checked)
              }
            />
            <span>Exclude Profit</span>
          </label>
        </td>

        <td>
          <div className="customer-name">
            {customerName}
          </div>

          <div className="order-id-small">
            #{order.id.slice(0, 8)}
          </div>
        </td>

        <td className="amount-cell">
          ₹{orderValue}
        </td>

        <td className={`amount-cell ${calculateNormalOrderProfit(order) < 0 ? "loss" : "gain"} ${excluded ? "excluded-profit-cell" : ""}`}>
          {excluded ? "Excluded" : formatMoney(calculateNormalOrderProfit(order))}
        </td>

        <td>
          <span
            className={`daily-status status-${statusClass}`}
          >
            {order.status || "Pending"}
          </span>
        </td>

        {order.orderType === "storeOrder" && (
          <>
            <td>
              <span className="store-badge">
                Store
              </span>
            </td>

            <td>
              <strong>{sellerName}</strong>
            </td>
          </>
        )}

        {order.orderType === "order" && (
          <>
            <td className="empty-seller">—</td>
            <td className="empty-seller">—</td>
          </>
        )}

        {renderChecks(order)}
      </tr>
    );
  };

  /*
   * ------------------------------------------------------------
   * LOADING
   * ------------------------------------------------------------
   */
  if (loading) {
    return (
      <div className="daily-orders-loading">
        <div className="loading-spinner"></div>
        <p>
          Loading orders for {formatDisplayDate(selectedDate)}...
        </p>
      </div>
    );
  }

  /*
   * ------------------------------------------------------------
   * UI
   * ------------------------------------------------------------
   */
  return (
    <div className="daily-orders-page print-container">
      {/* HEADER */}
      <div className="daily-orders-header">
        <div>
          <div className="page-eyebrow">
            DAILY OPERATIONS
          </div>

          <h1>Daily Orders</h1>

          <p>
            Review and complete the order checklist
            for the selected date.
          </p>
        </div>

        <div className="daily-header-actions">
          <button
            className="btn-secondary"
            onClick={() =>
              setShowChecklistSettings(
                !showChecklistSettings
              )
            }
          >
            ⚙ Checklist Settings
          </button>

          <button
            className="btn-print"
            onClick={() => window.print()}
          >
            🖨 Print
          </button>
        </div>
      </div>

      {/* DATE CONTROL */}
      <div className="daily-control-card">
        <div className="date-navigation">
          <button
            className="date-nav-btn"
            onClick={() => changeDate(-1)}
            aria-label="Previous day"
          >
            ←
          </button>

          <div className="selected-date-wrapper">
            <span className="date-label">
              ORDER DATE
            </span>

            <input
              type="date"
              value={selectedDate}
              onChange={(event) =>
                setSelectedDate(event.target.value)
              }
              className="daily-date-input"
            />

            <strong>
              {formatDisplayDate(selectedDate)}
            </strong>
          </div>

          <button
            className="date-nav-btn"
            onClick={() => changeDate(1)}
            aria-label="Next day"
          >
            →
          </button>
        </div>

        <button
          className="today-btn"
          onClick={goToToday}
        >
          Today
        </button>
      </div>

      {/* CHECKLIST SETTINGS */}
      {showChecklistSettings && (
        <div className="checklist-settings">
          <div className="settings-title">
            Daily Checklist
          </div>

          <p className="settings-description">
            Set the four checks you want to complete
            for every order.
          </p>

          <div className="check-settings-grid">
            {checkLabels.map((label, index) => (
              <div
                className="setting-field"
                key={index}
              >
                <label>
                  Check {index + 1}
                </label>

                <input
                  type="text"
                  value={label}
                  maxLength={40}
                  onChange={(event) =>
                    handleCheckLabelChange(
                      index,
                      event.target.value
                    )
                  }
                />
              </div>
            ))}
          </div>

          <div className="settings-actions">
            <button
              className="btn-secondary"
              onClick={() =>
                setShowChecklistSettings(false)
              }
            >
              Cancel
            </button>

            <button
              className="btn-save"
              disabled={savingSettings}
              onClick={saveChecklistSettings}
            >
              {savingSettings
                ? "Saving..."
                : "Save Checklist"}
            </button>
          </div>
        </div>
      )}

      {/* SUMMARY */}
      <div className="daily-summary">
        <div className="summary-card">
          <span>Normal Orders</span>
          <strong>{activeNormalOrders.length}</strong>
        </div>

        <div className="summary-card">
          <span>Store Orders</span>
          <strong>{activeStoreOrders.length}</strong>
        </div>

        <div className="summary-card">
          <span>Total Orders</span>
          <strong>{activeNormalOrders.length + activeStoreOrders.length}</strong>
        </div>

        <div className="summary-card total-value-card">
          <span>Normal Order Value</span>
          <strong>{formatMoney(normalOrderTotal)}</strong>
        </div>

        <div className="summary-card total-value-card">
          <span>Normal Order Profit</span>
          <strong>{formatMoney(normalProfitTotal)}</strong>
        </div>

        <div className="summary-card total-value-card">
          <span>Store Order Value</span>
          <strong>{formatMoney(storeFinancialTotals.orderValue)}</strong>
        </div>

        <div className="summary-card total-value-card">
          <span>Dropshipper Profit</span>
          <strong>{formatMoney(totalDropshipperProfit)}</strong>
        </div>

        <div className="summary-card total-value-card">
          <span>Our Store Profit</span>
          <strong>{formatMoney(storeFinancialTotals.ourProfit)}</strong>
        </div>

        <div className="summary-card total-value-card">
          <span>Total Order Value</span>
          <strong>{formatMoney(totalBusinessOrderValue)}</strong>
        </div>

        <div className="summary-card total-value-card">
          <span>Total Business Profit</span>
          <strong>{formatMoney(totalOurProfit)}</strong>
        </div>
      </div>

      {/* NORMAL ORDERS */}
      <section className="daily-section">
        <div className="section-heading">
          <div>
            <span className="section-number">
              01
            </span>

            <div>
              <h2>Orders</h2>

              <p>
                Direct customer orders
              </p>
            </div>
          </div>

          <span className="section-count">
            {activeNormalOrders.length} included orders
          </span>
        </div>

        <div className="daily-table-wrapper">
          <table className="daily-orders-table">
            <thead>
              <tr>
                <th>Exclude</th>
                <th>Customer</th>
                <th>Order Value</th>
                <th>Profit</th>
                <th>Status</th>
                <th>Seller</th>
                <th>Seller Name</th>

                {checkLabels.map(
                  (label, index) => (
                    <th key={index}>
                      {label}
                    </th>
                  )
                )}
              </tr>
            </thead>

            <tbody>
              {filteredOrders.length === 0 ? (
                <tr>
                  <td
                    colSpan={
                      7 + checkLabels.length
                    }
                    className="empty-state"
                  >
                    No normal orders for{" "}
                    {formatDisplayDate(
                      selectedDate
                    )}
                    .
                  </td>
                </tr>
              ) : (
                filteredOrders.map(
                  renderOrderRow
                )
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* STORE ORDERS */}
      <section className="daily-section store-orders-section">
        <div className="section-heading">
          <div>
            <span className="section-number store-number">
              02
            </span>

            <div>
              <h2>Store Orders</h2>

              <p>Marketplace / seller orders</p>
            </div>
          </div>

          <span className="section-count">
            {activeStoreOrders.length} included orders · {storeOrdersBySeller.length} sellers
          </span>
        </div>

        {/* STORE FINANCIAL SUMMARY */}
        <div className="store-financial-summary">
          <div className="store-financial-card store-financial-primary">
            <span>Total Order Value</span>
            <strong>{formatMoney(storeFinancialTotals.orderValue)}</strong>
            <small>Customer selling value</small>
          </div>

          <div className="store-financial-card">
            <span>Admin Order Value</span>
            <strong>{formatMoney(storeFinancialTotals.adminOrderValue)}</strong>
            <small>Purchase rate × quantity</small>
          </div>

          <div className="store-financial-card store-financial-profit">
            <span>Our Profit</span>
            <strong>{formatMoney(storeFinancialTotals.ourProfit)}</strong>
            <small>Seller cost − admin purchase</small>
          </div>

          <div className="store-financial-card">
            <span>Dropshipper Profit</span>
            <strong>{formatMoney(storeFinancialTotals.sellerProfit)}</strong>
            <small>Selling total − seller cost</small>
          </div>

          <div className="store-financial-card">
            <span>Admin Payable</span>
            <strong>{formatMoney(storeFinancialTotals.adminPayable)}</strong>
            <small>Seller cost + shipping</small>
          </div>
        </div>

        {filteredStoreOrders.length === 0 ? (
          <div className="daily-table-wrapper">
            <div className="empty-state store-empty-state">
              No store orders for {formatDisplayDate(selectedDate)}.
            </div>
          </div>
        ) : (
          <div className="seller-order-groups">
            {storeOrdersBySeller.map((group, sellerIndex) => (
              <div
                className="seller-order-group"
                key={group.sellerId}
              >
                {/* SELLER HEADER */}
                <div className="seller-group-header">
                  <div className="seller-group-title">
                    <span className="seller-group-number">
                      {String(sellerIndex + 1).padStart(2, "0")}
                    </span>

                    <div>
                      <h3>{group.sellerName}</h3>
                      <span>
                        {group.totals.activeOrderCount} included order{group.totals.activeOrderCount === 1 ? "" : "s"}
                      </span>
                    </div>
                  </div>

                  <div className="seller-group-financials">
                    <div>
                      <span>Order Value</span>
                      <strong>{formatMoney(group.totals.orderValue)}</strong>
                    </div>

                    {/* <div>
                      <span>Admin Value</span>
                      <strong>{formatMoney(group.totals.adminOrderValue)}</strong>
                    </div> */}

                    <div>
                      <span>Seller Profit</span>
                      <strong>{formatMoney(group.totals.sellerProfit)}</strong>
                    </div>

                    <div className="seller-profit-highlight">
                      <span>Our Profit</span>
                      <strong>{formatMoney(group.totals.ourProfit)}</strong>
                    </div>

                    <div>
                      <span>Admin Payable</span>
                      <strong>{formatMoney(group.totals.adminPayable)}</strong>
                    </div>
                  </div>
                </div>

                {/* SELLER TABLE */}
                <div className="daily-table-wrapper seller-table-wrapper">
                  <table className="daily-orders-table seller-orders-table">
                    <thead>
                      <tr>
                        <th>Exclude</th>
                        <th>Customer</th>
                        <th>Order Value</th>
                        <th>Seller Cost</th>
                        <th>Dropshipper Profit</th>
                        <th>Admin Payable</th>
                        <th>Our Profit</th>
                        <th>Status</th>
                        {checkLabels.map((label, index) => (
                          <th key={index}>{label}</th>
                        ))}
                      </tr>
                    </thead>

                    <tbody>
                      {group.orders.map((order) => {
                        const customerName =
                          order.billingInfo?.fullName ||
                          order.customerName ||
                          order.userName ||
                          "Unknown Customer";
                        const financials =
                          calculateStoreOrderFinancials(order);
                        const statusClass = String(
                          order.status || "pending"
                        )
                          .toLowerCase()
                          .replace(/\s+/g, "-");
                        const excluded = isProfitExcluded(order);
                        const excludeSaving = savingExclude === `${selectedDate}_${order.orderType}_${order.id}`;

                        return (
                          <tr
                            key={`seller-${order.id}`}
                            className={excluded ? "profit-excluded-row" : ""}
                          >
                            <td className="profit-exclude-cell">
                              <label className="profit-exclude-control" title="Exclude this order from profit calculations">
                                <input
                                  type="checkbox"
                                  checked={excluded}
                                  disabled={excludeSaving}
                                  onChange={(event) =>
                                    handleProfitExcludeChange(order, event.target.checked)
                                  }
                                />
                                <span>Exclude Profit</span>
                              </label>
                            </td>

                            <td>
                              <div className="customer-name">
                                {customerName}
                              </div>
                              <div className="order-id-small">
                                #{order.id.slice(0, 8)}
                              </div>
                            </td>

                            <td className="amount-cell">
                              {formatMoney(financials.orderValue)}
                            </td>

                            <td className="amount-cell">
                              {formatMoney(financials.sellerCost)}
                            </td>

                            <td className={`amount-cell seller-profit-cell ${excluded ? "excluded-profit-cell" : ""}`}>
                              {excluded ? "Excluded" : formatMoney(financials.sellerProfit)}
                            </td>

                            <td className="amount-cell">
                              {formatMoney(financials.adminPayable)}
                            </td>

                            <td className={`amount-cell our-profit-cell ${excluded ? "excluded-profit-cell" : ""}`}>
                              {excluded ? "Excluded" : formatMoney(financials.ourProfit)}
                            </td>

                            <td>
                              <span
                                className={`daily-status status-${statusClass}`}
                              >
                                {order.status || "Pending"}
                              </span>
                            </td>

                            {renderChecks(order)}
                          </tr>
                        );
                      })}
                    </tbody>

                    <tfoot>
                      <tr className="seller-table-total-row">
                        <td colSpan={2}>SELLER TOTAL</td>
                        <td>{formatMoney(group.totals.orderValue)}</td>
                        <td>{formatMoney(group.totals.sellerCost)}</td>
                        <td>{formatMoney(group.totals.sellerProfit)}</td>
                        <td>{formatMoney(group.totals.adminPayable)}</td>
                        <td>{formatMoney(group.totals.ourProfit)}</td>
                        <td colSpan={checkLabels.length}>—</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* PRINT FOOTER */}
      <div className="daily-print-footer">
        <span>Daily Orders Report</span>

        <span>
          {formatDisplayDate(selectedDate)}
        </span>
      </div>
    </div>
  );
};

export default AdminDailyOrders;
