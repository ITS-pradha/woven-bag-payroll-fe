import { QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { ConfirmProvider } from "../components/confirm-dialog/confirm-dialog";
import { ToastProvider } from "../components/toast/toast";
import { createQueryClient } from "./query-client";

interface AppProvidersProps {
  children: ReactNode;
}

export function AppProviders({ children }: AppProvidersProps) {
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <ConfirmProvider>
        <ToastProvider>{children}</ToastProvider>
      </ConfirmProvider>
    </QueryClientProvider>
  );
}
