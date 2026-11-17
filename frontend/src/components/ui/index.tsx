/** Rack's UI primitives. Tokens and rules: DESIGN.md. */
import { AnimatePresence, m, useReducedMotion, useTransform } from "motion/react";
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/utils";
import { INSTANT, SHEET_SPRING } from "../../lib/motion";
import { settleViewport } from "../../lib/viewport";
import { Icon } from "../icons/Icon";
import { useSheetDrag } from "./useSheetDrag";

/* ---------- buttons ---------- */

type ButtonVariant = "primary" | "secondary" | "plain" | "danger";
type ButtonSize = "sm" | "md" | "lg";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-foreground text-background",
  secondary: "bg-fill text-foreground",
  plain: "text-foreground hover:bg-fill",
  danger: "bg-fill text-danger",
};
const SIZE: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-footnote",
  md: "h-11 px-4 text-body",
  lg: "h-12 px-5 text-body",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }
>(({ variant = "secondary", size = "md", className, ...props }, ref) => (
  <button
    ref={ref}
    className={cn(
      "press inline-flex items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap select-none",
      "disabled:pointer-events-none disabled:opacity-40",
      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground",
      VARIANT[variant],
      SIZE[size],
      className,
    )}
    {...props}
  />
));
Button.displayName = "Button";

/** 44px hit area; `glass` for buttons floating over photos or bars. */
export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { label: string; glass?: boolean; active?: boolean }
>(({ label, glass, active, className, children, ...props }, ref) => (
  <button
    ref={ref}
    aria-label={label}
    title={label}
    className={cn(
      "press inline-flex size-11 shrink-0 items-center justify-center rounded-full",
      "disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-foreground",
      glass ? "glass text-foreground shadow-sm" : "text-foreground hover:bg-fill",
      active && "text-accent",
      className,
    )}
    {...props}
  >
    {children}
  </button>
));
IconButton.displayName = "IconButton";

export function Chip({
  selected,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button
      aria-pressed={selected}
      className={cn(
        "press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-footnote font-medium whitespace-nowrap",
        selected ? "bg-foreground text-background" : "bg-fill text-foreground",
        className,
      )}
      {...props}
    />
  );
}

/* ---------- segmented control ---------- */

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div role="tablist" className={cn("inline-flex rounded-full bg-fill p-0.5", className)}>
      {options.map(([v, label]) => (
        <button
          key={v}
          role="tab"
          aria-selected={value === v}
          onClick={() => onChange(v)}
          className={cn(
            "press h-8 rounded-full px-4 text-footnote font-semibold transition-colors",
            value === v ? "bg-elevated text-foreground shadow-sm" : "text-muted",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/* ---------- switch (iOS style) ---------- */

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors",
        checked ? "bg-accent" : "bg-fill-strong",
      )}
    >
      <span
        className={cn(
          "absolute top-[2px] left-[2px] size-[27px] rounded-full bg-white shadow transition-transform",
          checked && "translate-x-5",
        )}
      />
    </button>
  );
}

/* ---------- inset grouped list ---------- */

export function Group({
  title,
  footer,
  children,
  className,
}: {
  title?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-1.5", className)}>
      {title && <h2 className="px-4 text-footnote font-medium text-muted uppercase tracking-wide">{title}</h2>}
      <div className="divide-y divide-border overflow-hidden rounded-group bg-elevated dark:bg-surface">{children}</div>
      {footer && <p className="px-4 text-footnote text-muted">{footer}</p>}
    </section>
  );
}

export function Row({
  label,
  detail,
  children,
  className,
}: {
  label?: ReactNode;
  detail?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-11 items-center gap-3 px-4 py-2.5", className)}>
      {label && (
        <div className="min-w-0 flex-1">
          <div className="text-body">{label}</div>
          {detail && <div className="text-footnote text-muted">{detail}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

/* ---------- form fields ---------- */

const FIELD = cn(
  "h-11 w-full rounded-photo bg-fill px-3.5 text-body text-foreground placeholder:text-subtle",
  "outline-none focus:ring-2 focus:ring-foreground/20",
);

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <input ref={ref} className={cn(FIELD, className)} {...props} />,
);
Input.displayName = "Input";

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(FIELD, "h-24 py-2.5", className)} {...props} />;
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: (id: string) => ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-footnote font-medium text-muted">
        {label}
      </label>
      {children(id)}
      {hint && <p className="text-caption text-muted">{hint}</p>}
    </div>
  );
}

export function Select({
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(FIELD, "appearance-none pr-8", className)} {...props} />;
}

/* ---------- sheet (bottom sheet on phone, centred modal on desktop) ---------- */

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  actions,
  size = "auto",
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Extra header buttons, before Close (e.g. Edit). */
  actions?: ReactNode;
  size?: "auto" | "full" | "wide";
  className?: string;
}) {
  const reduce = useReducedMotion();
  const panel = useRef<HTMLDivElement>(null);
  // swipe down to close (v1.2): the drag layer follows the finger, the scrim fades with it
  const dragY = useSheetDrag(open, panel, onClose, !!reduce);
  const scrimFade = useTransform(dragY, [0, 400], [1, 0.25]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    panel.current?.focus();
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
      requestAnimationFrame(settleViewport);
    };
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-6">
          <m.div className="absolute inset-0" style={{ opacity: scrimFade }}>
            <m.div
              className="absolute inset-0 bg-scrim"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduce ? 0 : 0.2 }}
              onClick={onClose}
            />
          </m.div>
          {/* drag layer: separate from the panel so the swipe offset never fights its enter/exit */}
          <m.div data-testid="sheet-drag-layer" className="relative flex w-full justify-center" style={{ y: dragY }}>
          <m.div
            ref={panel}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={typeof title === "string" ? title : undefined}
            initial={reduce ? { opacity: 0 } : { y: "100%" }}
            animate={reduce ? { opacity: 1 } : { y: 0 }}
            exit={reduce ? { opacity: 0 } : { y: "100%" }}
            transition={reduce ? INSTANT : SHEET_SPRING}
            className={cn(
              "relative flex w-full flex-col overflow-hidden bg-background outline-none dark:bg-surface",
              "rounded-t-sheet md:rounded-sheet md:shadow-2xl",
              size === "full" ? "h-[calc(100dvh-env(safe-area-inset-top)-12px)] md:h-[min(860px,90dvh)]" : "max-h-[90dvh]",
              size === "wide" || size === "full" ? "md:max-w-4xl" : "md:max-w-lg",
              className,
            )}
          >
            {/* grabber + header: dragging here always moves the sheet, so the browser mustn't pan */}
            <div data-sheet-header className="flex touch-none items-center gap-2 px-4 pt-3 pb-2">
              <div aria-hidden className="absolute top-1.5 left-1/2 h-1 w-9 -translate-x-1/2 rounded-full bg-fill-strong md:hidden" />
              <div className="min-w-0 flex-1 truncate text-headline font-semibold">{title}</div>
              {actions}
              <IconButton label="Close" onClick={onClose} className="-mr-2 bg-fill size-9">
                <Icon name="close" size={18} />
              </IconButton>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
            {footer && <div className="border-t border-border px-4 pt-3 pb-[max(env(safe-area-inset-bottom),12px)]">{footer}</div>}
          </m.div>
          </m.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/* ---------- popover menu ---------- */

export function Menu({
  trigger,
  items,
  align = "right",
}: {
  trigger: (props: { onClick: () => void; "aria-expanded": boolean }) => ReactNode;
  items: { label: string; icon?: ReactNode; onSelect: () => void; danger?: boolean; disabled?: boolean }[];
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      {trigger({ onClick: () => setOpen((o) => !o), "aria-expanded": open })}
      <AnimatePresence>
        {open && (
          <m.div
            role="menu"
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.12 }}
            className={cn(
              "absolute top-full z-40 mt-1 min-w-52 overflow-hidden rounded-photo bg-elevated py-1 shadow-xl ring-1 ring-border",
              align === "right" ? "right-0 origin-top-right" : "left-0 origin-top-left",
            )}
          >
            {items.map((it) => (
              <button
                key={it.label}
                role="menuitem"
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onSelect();
                }}
                className={cn(
                  "flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-body hover:bg-fill disabled:opacity-40",
                  it.danger && "text-danger",
                )}
              >
                {it.icon}
                {it.label}
              </button>
            ))}
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ---------- states ---------- */

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center px-6 py-16 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-fill text-muted">{icon}</div>
      <h3 className="text-headline font-semibold">{title}</h3>
      {children && <p className="mt-1.5 text-footnote text-muted">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-photo bg-fill", className)} />;
}
