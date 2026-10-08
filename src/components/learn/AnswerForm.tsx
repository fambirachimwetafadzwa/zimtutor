"use client";

import { useId, useState } from "react";
import type { LearnerAnswer } from "@/lib/marking/spec";
import type { PublicQuestion } from "@/lib/questions/bank-rows";
import { keepNumbersTogether } from "@/lib/format";

/**
 * Where a child answers. One form per kind of question; each builds the answer in the shape the marker
 * expects (an option letter, true or false, a list in order, pairs, boxes, or text). The question it is
 * for is the `key` of the form, so a new question always starts empty.
 */

const button =
  "min-h-12 rounded-xl bg-brand px-6 text-lg font-bold text-brand-contrast disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50";
const field =
  "min-h-12 w-full rounded-xl border-2 border-border bg-surface px-4 text-lg focus:border-brand";

export function AnswerForm({
  question,
  disabled,
  wrongTries = 0,
  onSubmit,
}: {
  question: PublicQuestion;
  disabled: boolean;
  /** Wrong tries so far: a choice made before is cleared, so the child must choose again. */
  wrongTries?: number;
  onSubmit: (answer: LearnerAnswer) => void;
}) {
  // The form follows how the question is marked. Should a question ever lack what its form needs, a
  // text box still lets the child answer (it is then marked as typed text, never silently skipped).
  switch (question.answerKind) {
    case "CHOICE":
      if (question.options)
        return (
          <Choice
            key={wrongTries}
            question={question}
            options={question.options}
            disabled={disabled}
            onSubmit={onSubmit}
          />
        );
      break;
    case "TRUE_FALSE":
      return <TrueFalse disabled={disabled} onSubmit={onSubmit} />;
    case "ORDER":
      if (question.items)
        return <Ordering items={question.items} disabled={disabled} onSubmit={onSubmit} />;
      break;
    case "MATCH":
      if (question.matching)
        return <Matching matching={question.matching} disabled={disabled} onSubmit={onSubmit} />;
      break;
    case "BOXES":
      if (question.answerFields && question.answerFields.length > 0)
        return <Boxes fields={question.answerFields} disabled={disabled} onSubmit={onSubmit} />;
      break;
    case "TEXT":
      break;
  }
  return <Typed hint={question.answerHint} disabled={disabled} onSubmit={onSubmit} />;
}

type Props = { disabled: boolean; onSubmit: (answer: LearnerAnswer) => void };

function Choice({
  options,
  disabled,
  onSubmit,
}: Props & { question: PublicQuestion; options: Array<{ id: string; text: string }> }) {
  const [picked, setPicked] = useState<string | null>(null);
  const name = useId();
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (picked !== null) onSubmit(picked);
      }}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="pb-2 text-base font-semibold text-muted">Choose one answer</legend>
        {options.map((option, index) => (
          <label
            key={option.id}
            className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border-2 px-4 py-2 text-lg ${
              picked === option.id ? "border-brand bg-brand/10" : "border-border bg-surface"
            }`}
          >
            <input
              type="radio"
              name={name}
              value={option.id}
              checked={picked === option.id}
              onChange={() => setPicked(option.id)}
              className="size-5 accent-brand"
              {...(index === 0 ? { "data-autofocus": true } : {})}
            />
            <span className="font-bold">{option.id}.</span>
            <span>{keepNumbersTogether(option.text)}</span>
          </label>
        ))}
      </fieldset>
      <button type="submit" className={button} disabled={disabled || picked === null}>
        Check my answer
      </button>
    </form>
  );
}

function TrueFalse({ disabled, onSubmit }: Props) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-base font-semibold text-muted">Is the statement true or false?</p>
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          className={button}
          aria-disabled={disabled}
          onClick={() => !disabled && onSubmit(true)}
          data-autofocus
        >
          True
        </button>
        <button
          type="button"
          className={button}
          aria-disabled={disabled}
          onClick={() => !disabled && onSubmit(false)}
        >
          False
        </button>
      </div>
    </div>
  );
}

function Typed({ hint, disabled, onSubmit }: Props & { hint: string | undefined }) {
  const [text, setText] = useState("");
  const id = useId();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(text.trim());
      }}
    >
      <label htmlFor={id} className="text-base font-semibold text-muted">
        Your answer
      </label>
      <input
        id={id}
        className={field}
        value={text}
        onChange={(e) => setText(e.target.value)}
        readOnly={disabled}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        aria-describedby={hint ? `${id}-hint` : undefined}
        data-autofocus
      />
      {hint ? (
        <p id={`${id}-hint`} className="text-base text-muted">
          {hint}
        </p>
      ) : null}
      <button type="submit" className={button} disabled={disabled || text.trim() === ""}>
        Check my answer
      </button>
    </form>
  );
}

function Boxes({
  fields,
  disabled,
  onSubmit,
}: Props & { fields: Array<{ id: string; label: string; unit?: string | undefined }> }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const base = useId();
  const complete = fields.every((f) => (values[f.id] ?? "").trim() !== "");
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(Object.fromEntries(fields.map((f) => [f.id, (values[f.id] ?? "").trim()])));
      }}
    >
      {fields.map((f, index) => (
        <div key={f.id} className="flex flex-col gap-1">
          <label htmlFor={`${base}-${f.id}`} className="text-base font-semibold">
            {f.label}
          </label>
          <div className="flex items-center gap-2">
            <input
              id={`${base}-${f.id}`}
              className={field}
              value={values[f.id] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
              readOnly={disabled}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              {...(index === 0 ? { "data-autofocus": true } : {})}
            />
            {f.unit ? <span className="text-lg font-semibold">{f.unit}</span> : null}
          </div>
        </div>
      ))}
      <button type="submit" className={button} disabled={disabled || !complete}>
        Check my answer
      </button>
    </form>
  );
}

function Ordering({ items, disabled, onSubmit }: Props & { items: string[] }) {
  const [order, setOrder] = useState<string[]>(items);
  const [said, setSaid] = useState("");
  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length) return;
    const next = [...order];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    setOrder(next);
    setSaid(`${item} is now number ${to + 1} of ${next.length}`);
  };
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!disabled) onSubmit(order);
      }}
    >
      <p className="text-base font-semibold text-muted">
        Use the arrows to put the answers in the right order.
      </p>
      <ol className="flex flex-col gap-2">
        {order.map((item, i) => (
          <li
            key={item}
            className="flex items-center gap-3 rounded-xl border-2 border-border bg-surface px-3 py-2"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand/10 font-bold">
              {i + 1}
            </span>
            <span className="grow text-lg">{keepNumbersTogether(item)}</span>
            <button
              type="button"
              className="min-h-11 min-w-11 rounded-lg border border-border text-xl font-bold disabled:opacity-40"
              disabled={disabled || i === 0}
              onClick={() => move(i, i - 1)}
              aria-label={`Move ${item} up`}
            >
              ↑
            </button>
            <button
              type="button"
              className="min-h-11 min-w-11 rounded-lg border border-border text-xl font-bold disabled:opacity-40"
              disabled={disabled || i === order.length - 1}
              onClick={() => move(i, i + 1)}
              aria-label={`Move ${item} down`}
            >
              ↓
            </button>
          </li>
        ))}
      </ol>
      <p className="sr-only" aria-live="polite">
        {said}
      </p>
      <button type="submit" className={button} aria-disabled={disabled} data-autofocus>
        Check my answer
      </button>
    </form>
  );
}

function Matching({
  matching,
  disabled,
  onSubmit,
}: Props & { matching: { left: string[]; right: string[] } }) {
  const [pairs, setPairs] = useState<Record<string, string>>({});
  const base = useId();
  const complete = matching.left.every((l) => (pairs[l] ?? "") !== "");
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(Object.fromEntries(matching.left.map((l) => [l, pairs[l] ?? ""])));
      }}
    >
      <p className="text-base font-semibold text-muted">
        Match each one on the left with its partner.
      </p>
      {matching.left.map((left, i) => (
        <div key={left} className="flex flex-wrap items-center gap-3">
          <label htmlFor={`${base}-${i}`} className="min-w-28 text-lg font-bold">
            {keepNumbersTogether(left)}
          </label>
          <select
            id={`${base}-${i}`}
            className={`${field} w-auto min-w-44 grow`}
            value={pairs[left] ?? ""}
            onChange={(e) => setPairs((p) => ({ ...p, [left]: e.target.value }))}
            disabled={disabled}
            {...(i === 0 ? { "data-autofocus": true } : {})}
          >
            <option value="">Choose…</option>
            {matching.right.map((right) => (
              <option key={right} value={right}>
                {keepNumbersTogether(right)}
              </option>
            ))}
          </select>
        </div>
      ))}
      <button type="submit" className={button} disabled={disabled || !complete}>
        Check my answer
      </button>
    </form>
  );
}
