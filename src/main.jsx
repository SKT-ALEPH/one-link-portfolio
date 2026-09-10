import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import PrivatePage from "./PrivatePage";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {window.location.pathname.replace(/\/$/, "").endsWith("/private") ? <PrivatePage /> : <App />}
  </React.StrictMode>,
);
