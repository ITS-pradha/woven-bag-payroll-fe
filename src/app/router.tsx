import { Navigate, createBrowserRouter } from "react-router-dom";

import { ProtectedRoute } from "../features/auth/components/protected-route";
import { AppShell } from "./app-shell";
import { RouteErrorBoundary } from "./route-error-boundary";
import { RouteHydrationFallback } from "./route-hydration-fallback";

export const router = createBrowserRouter([
  {
    path: "/login",
    lazy: () => import("../routes/login.route"),
  },
  {
    element: <ProtectedRoute />,
    errorElement: <RouteErrorBoundary />,
    HydrateFallback: RouteHydrationFallback,
    children: [
      {
        path: "/",
        element: <AppShell />,
        children: [
          {
            index: true,
            element: <Navigate to="/manual-data" replace />,
          },
          {
            path: "manual-data",
            lazy: () => import("../routes/manual-data.route"),
          },
          {
            path: "detail",
            lazy: () => import("../routes/detail.route"),
          },
          {
            path: "summary",
            lazy: () => import("../routes/summary.route"),
          },
          {
            path: "rates",
            lazy: () => import("../routes/rates.route"),
          },
          {
            path: "*",
            lazy: () => import("../routes/not-found.route"),
          },
        ],
      },
    ],
  },
]);
