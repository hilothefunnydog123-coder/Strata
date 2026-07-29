import { useId } from 'react';

/**
 * Form fields.
 *
 * The error message is rendered above the control, not below it, and is
 * associated with aria-describedby. Screen readers reach it before the input
 * rather than after the user has already typed the wrong thing again.
 *
 * Errors say what went wrong and what to do about it. They do not apologise.
 */

export interface FieldProps {
  label: string;
  name: string;
  error?: string | undefined;
  hint?: string;
  required?: boolean;
  children: (props: {
    id: string;
    name: string;
    'aria-describedby': string | undefined;
    'aria-invalid': boolean | undefined;
    required: boolean;
  }) => React.ReactNode;
}

export function Field({ label, name, error, hint, required, children }: FieldProps) {
  const reactId = useId();
  const id = `${name}-${reactId}`;
  const errorId = error ? `${id}-error` : undefined;
  const hintId = hint ? `${id}-hint` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="space-y-1.5">
      {/*
        The required marker sits outside the label element, not inside it. Text
        inside a label becomes the control's label text, so an asterisk in there
        turns the field's name into "New password*" for anything matching by
        label, which includes assistive technology and every test. The required
        state is carried by the required attribute on the control, which is what
        a screen reader announces anyway.
      */}
      <div className="flex items-baseline gap-1">
        <label htmlFor={id} className="block text-sm font-medium text-ink">
          {label}
        </label>
        {required ? (
          <span className="text-denied" aria-hidden="true">
            *
          </span>
        ) : null}
      </div>
      {hint ? (
        <p id={hintId} className="text-xs text-ink-2">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs font-medium text-denied">
          {error}
        </p>
      ) : null}
      {children({
        id,
        name,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
        required: Boolean(required),
      })}
    </div>
  );
}

const CONTROL =
  'block w-full rounded-[3px] border bg-paper-2 px-2.5 py-1.5 text-sm text-ink ' +
  'placeholder:text-ink-2/70 disabled:bg-paper-sunk disabled:text-ink-2';

export function Input({
  className = '',
  invalid,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      className={`${CONTROL} ${invalid ? 'border-denied' : 'border-rule-strong'} ${className}`}
      {...props}
    />
  );
}

export function Textarea({
  className = '',
  invalid,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      className={`${CONTROL} ${invalid ? 'border-denied' : 'border-rule-strong'} ${className}`}
      {...props}
    />
  );
}

export function Select({
  className = '',
  invalid,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select
      className={`${CONTROL} ${invalid ? 'border-denied' : 'border-rule-strong'} ${className}`}
      {...props}
    />
  );
}
