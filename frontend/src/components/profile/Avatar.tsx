import { initials } from "@rack/shared/account";
import type { Account } from "@rack/shared/types";
import { cn } from "../../lib/utils";

/** Your photo, or your initials on a quiet fill until you set one. */
export function Avatar({ account, size = 32, className }: { account?: Account | null; size?: number; className?: string }) {
  const name = account?.display_name || account?.username || "";
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-fill-strong text-muted select-none", className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
    >
      {account?.avatar ? (
        <img src={account.avatar} alt="" width={size} height={size} className="size-full object-cover" draggable={false} />
      ) : (
        <span className="font-semibold">{initials(name)}</span>
      )}
    </span>
  );
}
