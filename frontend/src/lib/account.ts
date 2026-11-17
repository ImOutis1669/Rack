import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

/** Your account (photo, name, role). Shared by the avatar button, Profile and Settings. */
export function useAccount() {
  return useQuery({ queryKey: ["account"], queryFn: api.account, staleTime: 5 * 60_000 });
}
