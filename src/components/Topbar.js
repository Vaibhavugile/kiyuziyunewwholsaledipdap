import "./topbar.css";

export default function Topbar() {
  const messages = [
    {
      icon: "🚚",
      text: "Wholesale Prices on Everyday Essentials",
    },
    {
      icon: "◇",
      text: "Home, Fashion, Beauty & Lifestyle",
    },
    {
      icon: "♧",
      text: "Support When You Need It",
    },
    {
      icon: "✦",
      text: "Login to View Wholesale Prices",
    },
    {
      icon: "🚚",
      text: "Wholesale Delivery Across India",
    },
    {
      icon: "◇",
      text: "Bulk Buying Made Easy",
    },
    {
      icon: "✧",
      text: "Secure Shopping & Payments",
    },
  ];

  return (
    <div className="topbar" aria-label="Everything Wholesale Market announcements">
      <div className="topbar-marquee">
        <div className="topbar-track">
          {[...messages, ...messages].map((item, index) => (
            <div className="topbar-item" key={`${item.text}-${index}`}>
              <span className="topbar-icon" aria-hidden="true">{item.icon}</span>
              <span className="topbar-text">{item.text}</span>
              <span className="topbar-dot" aria-hidden="true">•</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
