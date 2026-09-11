import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "maplibre-gl/dist/maplibre-gl.css";
import App from "./App";
import "./styles/app.css";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("The application root is missing");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
