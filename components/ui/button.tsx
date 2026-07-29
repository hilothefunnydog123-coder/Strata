import { forwardRef } from 'react';
import Link from 'next/link';

/**
 * Buttons.
 *
 * Four intents, and each one means something. Primary is the action colour and
 * nothing else uses it. Danger is the denied colour, used for the small number
 * of actions that take something away. Quiet is a button that has to sit in a
 * dense table without shouting. Ghost is for toolbars.
 *
 * No gradients, no shadows, no rounded pills. A button here looks like a control
 * on a form, because that is what it is.
 */

export type ButtonIntent = 'primary' | 'secondary' | 'danger' | 'quiet';
export type ButtonSize = 'sm' | 'md';

const BASE =
  'inline-flex items-center justify-center gap-1.5 border font-medium ' +
  'transition-colors duration-75 disabled:cursor-not-allowed disabled:opacity-50 ' +
  'rounded-[3px] whitespace-nowrap';

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-xs',
  md: 'h-9 px-3.5 text-sm',
};

const INTENTS: Record<ButtonIntent, string> = {
  primary:
    'on-action border-action bg-action text-white hover:bg-[#163d76] active:bg-[#122f5c]',
  secondary:
    'border-rule-strong bg-paper-2 text-ink hover:bg-paper-sunk active:bg-rule',
  danger:
    'on-action border-denied bg-denied text-white hover:bg-[#7f1717] active:bg-[#661212]',
  quiet:
    'border-transparent bg-transparent text-action hover:bg-action-wash active:bg-[#d6e0ee]',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  intent?: ButtonIntent;
  size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { intent = 'secondary', size = 'md', className = '', type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`${BASE} ${SIZES[size]} ${INTENTS[intent]} ${className}`}
      {...props}
    />
  );
});

export interface ButtonLinkProps extends React.ComponentProps<typeof Link> {
  intent?: ButtonIntent;
  size?: ButtonSize;
}

export function ButtonLink({
  intent = 'secondary',
  size = 'md',
  className = '',
  ...props
}: ButtonLinkProps) {
  return (
    <Link
      className={`${BASE} ${SIZES[size]} ${INTENTS[intent]} no-underline ${className}`}
      {...props}
    />
  );
}
