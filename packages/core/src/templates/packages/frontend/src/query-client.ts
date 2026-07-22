import { QueryClient } from "@tanstack/react-query";

// This TanStack Query client caches and coordinates the frontend's backend requests.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
