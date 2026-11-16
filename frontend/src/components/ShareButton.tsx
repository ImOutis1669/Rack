import { Share } from "lucide-react";
import type { BuyLink } from "../api/types";
import { SOURCE_LABEL } from "../lib/format";
import { shareLink, shareMessage } from "../lib/share";
import { toast } from "./Toast";
import { IconButton, Menu } from "./ui";

/** One share action per marketplace link (a grouped listing has several). */
export function shareTargets(links: BuyLink[]): { label: string; url: string }[] {
  return links.map((l) => ({ label: `Share ${SOURCE_LABEL[l.source]} link`, url: l.url }));
}

async function run(url: string, title: string): Promise<void> {
  const msg = shareMessage(await shareLink(url, title));
  if (msg) toast(msg);
}

/** Shares the marketplace URL (iOS share sheet, else copy). Grouped listings get a menu. */
export function ShareButton({ links, title, className }: { links: BuyLink[]; title: string; className?: string }) {
  const targets = shareTargets(links);
  const icon = <Share size={19} strokeWidth={1.9} />;
  if (targets.length === 0) return null;
  if (targets.length === 1) {
    const [only] = targets;
    return (
      <IconButton label={only!.label} onClick={() => void run(only!.url, title)} className={className}>
        {icon}
      </IconButton>
    );
  }
  return (
    <Menu
      trigger={(p) => (
        <IconButton label="Share" className={className} {...p}>
          {icon}
        </IconButton>
      )}
      items={targets.map((t) => ({
        label: t.label,
        icon: <Share size={16} />,
        onSelect: () => void run(t.url, title),
      }))}
    />
  );
}
