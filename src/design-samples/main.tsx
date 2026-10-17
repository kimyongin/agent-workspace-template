import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DesignSamples } from "./DesignSamples.tsx";
import "../styles/app.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DesignSamples />
  </StrictMode>,
);
