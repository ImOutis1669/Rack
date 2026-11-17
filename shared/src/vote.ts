export type Vote = -1 | 1 | null;

/** Tapping the active arrow clears the vote; tapping the other arrow switches to it. */
export function nextVote(current: Vote, tapped: -1 | 1): Vote {
  return current === tapped ? null : tapped;
}

/** Value posted to POST /api/listings/{id}/feedback (0 clears). */
export function voteValue(vote: Vote): -1 | 0 | 1 {
  return vote ?? 0;
}
