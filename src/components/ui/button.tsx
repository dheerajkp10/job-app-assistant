/**
 * Shared button components. Replaces the dozens of bespoke
 * Tailwind class strings scattered across the app — historically
 * the codebase had two competing CTAs (modern gradient + legacy
 * blue-600) and several intermediate sizes with no agreement. This
 * file is the single source of truth going forward.
 *
 * Variants
 * ────────
 *   primary    — gradient indigo→violet, shadow + hover lift. The
 *                principal CTA on every page (Refresh All, Save,
 *                Generate Master Resume, Apply, Submit, etc.)
 *   secondary  — quiet white with slate border. Co-action next to a
 *                primary (Cancel, Close, Back).
 *   ghost      — borderless slate text. Tertiary nav-style links.
 *   danger     — rose for destructive actions (Delete, Reset, Trash).
 *
 * Sizes
 * ─────
 *   sm — px-3 py-1.5 text-xs rounded-lg. Toolbar / dense panels.
 *   md — px-4 py-2 text-sm rounded-xl. Default for in-page CTAs.
 *   lg — px-5 py-2.5 text-sm rounded-xl. Page-header primaries.
 *
 * The component is a thin wrapper over <button> — every native prop
 * passes through. \`leftIcon\` / \`rightIcon\` slots take a lucide-style
 * SVG component; padding/sizing for the icon is handled internally.
 *
 * Why not HeroUI's Button? — HeroUI already exists in the project but
 * its data-attribute hover model conflicts with the tailwind-only
 * styling we use elsewhere, and migrating every CTA to HeroUI would
 * require touching nearly every page. This wrapper keeps the existing
 * Tailwind-first idiom while consolidating the styles.
 */

'use client';

import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** When true, the button shows a spinner and is disabled. The
   *  underlying click handler stays disabled even if `disabled` is
   *  not separately set. */
  isLoading?: boolean;
  /** Icon component rendered before the children. Sized via the
   *  Tailwind class assigned by the size variant. */
  leftIcon?: ReactNode;
  /** Icon component rendered after the children. */
  rightIcon?: ReactNode;
  /** Stretches the button to fill its parent's width. Useful in
   *  modals and mobile sticky footers. */
  fullWidth?: boolean;
}

// Tailwind classes per variant. Shared across all sizes; the size
// classes layer padding + text + radius on top.
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-btn-primary ' +
    'hover:from-indigo-600 hover:to-violet-600 hover:shadow-btn-primary-hover hover:-translate-y-0.5 ' +
    'active:translate-y-0 ' +
    'disabled:opacity-50 disabled:cursor-not-allowed disabled:translate-y-0 disabled:hover:shadow-btn-primary ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-2',
  secondary:
    'bg-white text-slate-700 border border-slate-200 ' +
    'hover:bg-slate-50 hover:border-slate-300 ' +
    'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-200 focus-visible:ring-offset-2',
  ghost:
    'bg-transparent text-slate-600 ' +
    'hover:bg-slate-100 hover:text-slate-800 ' +
    'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-200',
  danger:
    'bg-rose-600 text-white shadow-sm ' +
    'hover:bg-rose-700 hover:shadow-md ' +
    'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-rose-600 disabled:hover:shadow-sm ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200 focus-visible:ring-offset-2',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs font-semibold rounded-lg gap-1.5',
  md: 'px-4 py-2 text-sm font-semibold rounded-xl gap-2',
  lg: 'px-5 py-2.5 text-sm font-semibold rounded-xl gap-2',
};

const ICON_SIZE: Record<ButtonSize, string> = {
  sm: 'w-3.5 h-3.5',
  md: 'w-4 h-4',
  lg: 'w-4 h-4',
};

/**
 * Primary button — the only button component the rest of the app
 * should reach for. Picks variant + size via props; everything else
 * is a Tailwind override layered via `className`.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    isLoading = false,
    leftIcon,
    rightIcon,
    fullWidth = false,
    disabled,
    className = '',
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  const iconClass = ICON_SIZE[size];
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || isLoading}
      className={[
        'inline-flex items-center justify-center select-none',
        'transition-all duration-200',
        SIZE_CLASSES[size],
        VARIANT_CLASSES[variant],
        fullWidth ? 'w-full' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {isLoading ? (
        <Loader2 className={`${iconClass} animate-spin`} aria-hidden />
      ) : (
        leftIcon && <span className={iconClass} aria-hidden>{leftIcon}</span>
      )}
      {children}
      {rightIcon && !isLoading && <span className={iconClass} aria-hidden>{rightIcon}</span>}
    </button>
  );
});
