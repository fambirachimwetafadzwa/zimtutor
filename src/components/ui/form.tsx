"use client";

import { useFormStatus } from "react-dom";
import type {
  InputHTMLAttributes,
  ReactNode,
  Ref,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { useRevealed } from "./useRevealed";

/**
 * Submit button that disables itself while the Server Action runs (prevents double submits). `danger`
 * is for what cannot be undone.
 */
export function SubmitButton({
  children,
  pendingLabel = "Please wait…",
  className = "",
  tone = "normal",
}: {
  children: ReactNode;
  pendingLabel?: string;
  className?: string;
  tone?: "normal" | "danger";
}) {
  const { pending } = useFormStatus();
  const colour = tone === "danger" ? "bg-red-700 text-white" : "bg-brand text-brand-contrast";
  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className={`inline-flex min-h-12 w-full items-center justify-center rounded-xl px-6 py-3 text-lg font-semibold shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60 ${colour} ${className}`}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}

export function Field({
  label,
  name,
  error,
  hint,
  id = name,
  ...input
}: {
  label: string;
  name: string;
  error?: string;
  hint?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "name">) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-base font-semibold">
        {label}
      </label>
      <input
        id={id}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        className="min-h-12 rounded-xl border border-border bg-surface px-4 py-3 text-lg shadow-sm aria-[invalid=true]:border-red-600"
        {...input}
      />
      {hint ? (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * What a form has to say after it was sent. It is brought into view if it appeared out of sight;
 * pass `signal` (the form's state) so that a message that comes up again is shown again.
 */
export function FormMessage({
  error,
  message,
  signal,
}: {
  error?: string;
  message?: string;
  signal?: unknown;
}) {
  const ref = useRevealed<HTMLParagraphElement>(Boolean(error || message), signal);
  if (!error && !message) return null;
  return (
    <p
      ref={ref}
      role={error ? "alert" : "status"}
      className={`rounded-xl border px-4 py-3 text-base ${
        error
          ? "border-red-300 bg-red-50 text-red-800"
          : "border-emerald-300 bg-emerald-50 text-emerald-900"
      }`}
    >
      {error ?? message}
    </p>
  );
}

const controlClass =
  "rounded-xl border border-border bg-surface px-4 py-3 text-lg shadow-sm aria-[invalid=true]:border-red-600";

function Described({
  id,
  hint,
  error,
  children,
  label,
}: {
  id: string;
  hint?: string;
  error?: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-base font-semibold">
        {label}
      </label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const describedBy = (id: string, hint?: string, error?: string) =>
  [hint ? `${id}-hint` : undefined, error ? `${id}-error` : undefined].filter(Boolean).join(" ") ||
  undefined;

export function TextAreaField({
  label,
  name,
  error,
  hint,
  id = name,
  ...input
}: {
  label: string;
  name: string;
  error?: string;
  hint?: string;
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "name">) {
  return (
    <Described id={id} label={label} hint={hint} error={error}>
      <textarea
        id={id}
        name={name}
        rows={5}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={`min-h-32 ${controlClass}`}
        {...input}
      />
    </Described>
  );
}

export function SelectField({
  label,
  name,
  error,
  hint,
  options,
  id = name,
  ...input
}: {
  label: string;
  name: string;
  error?: string;
  hint?: string;
  options: Array<{ value: string; label: string }>;
  /** React 19 passes `ref` to function components as an ordinary prop. */
  ref?: Ref<HTMLSelectElement>;
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, "name">) {
  return (
    <Described id={id} label={label} hint={hint} error={error}>
      <select
        id={id}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={`min-h-12 ${controlClass}`}
        {...input}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Described>
  );
}
