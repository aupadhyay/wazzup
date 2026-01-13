import { createTRPCReact, httpBatchLink } from "@trpc/react-query"
import type { AppRouter } from "@thoughts/rpc"

export const trpc = createTRPCReact<AppRouter>()

const SIDECAR_PORT = import.meta.env.VITE_SIDECAR_PORT || "4318"

export const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: `http://localhost:${SIDECAR_PORT}`,
    }),
  ],
})
