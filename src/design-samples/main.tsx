import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DesignSamples } from "./DesignSamples.tsx";
import "../styles/app.css";
import "../components/related-items.css";
import "../features/settings/settings.css";
import "./samples.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DesignSamples />
  </StrictMode>,
);
