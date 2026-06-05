import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
// Single CSS entrypoint. app.css runs Tailwind and pulls in
// @sapporta/ui's tokens and base rules — edit it to customize.
import "./app.css";
import { SapportaApp } from "./SapportaApp";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <SapportaApp />
    </BrowserRouter>
  </StrictMode>,
);
