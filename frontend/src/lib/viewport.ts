/**
 * iOS home-screen apps leave the page scrolled past its end after the keyboard closes (or a
 * sheet unlocks scrolling), which lifts `position: fixed` bars like the tab bar off the bottom of
 * the screen until the next scroll. Nudging the scroll position back in range makes iOS re-lay
 * them out.
 */
export function settleViewport(): void {
  const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  window.scrollTo(window.scrollX, Math.min(window.scrollY, max));
}

const isField = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.matches("input, textarea, select") || el.isContentEditable);

export function installViewportFix(): () => void {
  let timer = 0;
  const later = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (!isField(document.activeElement)) settleViewport();
    }, 120);
  };
  const onFocusOut = (e: FocusEvent) => isField(e.target) && later();
  document.addEventListener("focusout", onFocusOut);
  window.visualViewport?.addEventListener("resize", later);
  return () => {
    window.clearTimeout(timer);
    document.removeEventListener("focusout", onFocusOut);
    window.visualViewport?.removeEventListener("resize", later);
  };
}
