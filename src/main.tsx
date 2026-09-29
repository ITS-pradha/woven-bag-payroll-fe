import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/app";
import "./design-system/styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Elemen root aplikasi tidak ditemukan.");
}

const appRoot = rootElement;

async function bootstrap() {
  if (
    import.meta.env.DEV &&
    import.meta.env.VITE_ENABLE_API_MOCKING === "true"
  ) {
    const { enableApiMocking } =
      await import("./test/mocks/enable-api-mocking");
    await enableApiMocking();
  }

  createRoot(appRoot).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
