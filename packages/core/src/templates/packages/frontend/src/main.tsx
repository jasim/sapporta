import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
// Single CSS entrypoint. app.css runs Tailwind and pulls in
// @sapporta/ui's tokens and base rules — edit it to customize.
import "./app.css";
import { SapportaApp } from "./SapportaApp";
import { queryClient } from "./query-client";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <SapportaApp />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
