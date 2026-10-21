
import "./topbar.css";

export default function Topbar() {
  const messages = [
    {
      icon: "🚚",
      text: "Wholesale Prices",
    },
    {
      icon: "◇",
      text: "Anti-Tarnish Jewellery",
    },
    {
      icon: "♧",
      text: "24×7 Support",
    },
    {
      icon: "✦",
      text: "Login To View Wholesale Prices",
    },
    {
      icon: "🚚",
      text: "Delivering Elegance Across India",
    },
    {
      icon: "◇",
      text: "Minimum Order Value ₹2,500",
    },
    {
      icon: "✧",
      text: "100% Secure Payments",
    },
  ];

  return (
    <div className="topbar">
      <div className="topbar-marquee">
        <div className="topbar-track">
          {[...messages, ...messages].map((item, index) => (
            <div className="topbar-item" key={index}>
              <span className="topbar-icon">{item.icon}</span>

              <span className="topbar-text">{item.text}</span>

              <span className="topbar-dot">•</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
