import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Teach tailwind-merge Rack's custom type sizes and radii (DESIGN.md), otherwise it mistakes
// `text-body` for a text colour and drops e.g. the primary button's `text-background`.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["largetitle", "title", "headline", "body", "footnote", "caption"],
      radius: ["photo", "group", "sheet"],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
