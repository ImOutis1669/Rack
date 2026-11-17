import { lazy, Suspense, useState } from "react";
import { useAccount } from "../../lib/account";
import { Avatar } from "./Avatar";

// Profile loads the first time it's opened, not with every page.
const ProfileSheet = lazy(() => import("./ProfileSheet").then((m) => ({ default: m.ProfileSheet })));

/** Your photo (or initials) in the top bar, where the settings gear was (v2.1). Opens Profile. */
export function AvatarButton() {
  const account = useAccount();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label="Profile"
        title="Profile"
        data-testid="avatar-button"
        onClick={() => {
          setLoaded(true);
          setOpen(true);
        }}
        className="press inline-flex size-11 items-center justify-center rounded-full hover:bg-fill"
      >
        <Avatar account={account.data} size={30} />
      </button>
      {loaded && (
        <Suspense fallback={null}>
          <ProfileSheet open={open} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
