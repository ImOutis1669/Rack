import type { Vote } from "@rack/shared/vote";
import { cn } from "../lib/utils";
import { IconButton } from "./ui";
import { Icon } from "./icons/Icon";

/**
 * Reddit-style upvote/downvote pair. Active arrow fills: up in accent green, down in danger red.
 * `compact` is the desktop hover version on photo tiles (glass, 36px); otherwise 44px targets.
 */
export function VoteButtons({
  vote,
  onVote,
  compact = false,
  className,
}: {
  vote: Vote;
  onVote: (v: -1 | 1) => void;
  compact?: boolean;
  className?: string;
}) {
  const size = compact ? 17 : 21;
  const button = compact ? "size-9" : "";
  return (
    <div
      role="group"
      aria-label="Vote"
      className={cn("inline-flex items-center rounded-full", compact ? "glass shadow-sm" : "bg-fill", className)}
    >
      <IconButton
        label="Upvote"
        title="Upvote: more like this"
        aria-pressed={vote === 1}
        onClick={() => onVote(1)}
        className={cn(button, "hover:bg-transparent", vote === 1 && "text-accent")}
      >
        <Icon name="vote-up" size={size} filled={vote === 1} />
      </IconButton>
      <IconButton
        label="Downvote"
        title="Downvote: less like this"
        aria-pressed={vote === -1}
        onClick={() => onVote(-1)}
        className={cn(button, "hover:bg-transparent", vote === -1 && "text-danger")}
      >
        <Icon name="vote-down" size={size} filled={vote === -1} />
      </IconButton>
    </div>
  );
}
