'use client';

import { Children, cloneElement, createContext, isValidElement, useContext, useId } from 'react';

/**
 * A labelled form row whose label is actually tied to its control (WCAG 1.3.1 / 4.1.2).
 *
 * The screens' local `Field` helpers drew a <label> next to the input with nothing linking
 * them, so a screen reader announced every field as just "edit text". The label now gets an
 * id, and the control is named by it:
 *  - a single native <input>/<select>/<textarea> child is given aria-labelledby (and the
 *    hint as aria-describedby) directly;
 *  - the screens' own Input components read the same ids from context (useFieldIds).
 */
const FieldIds = createContext<{ labelId: string; hintId?: string } | null>(null);

/** For an input component rendered inside a FormField: the props that name it. */
export function useFieldIds(): { 'aria-labelledby'?: string; 'aria-describedby'?: string } {
  const ids = useContext(FieldIds);
  return ids ? { 'aria-labelledby': ids.labelId, 'aria-describedby': ids.hintId } : {};
}

const NATIVE = new Set(['input', 'select', 'textarea']);

export function FormField({ label, hint, children, labelClassName, hintClassName }: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  labelClassName: string;
  hintClassName: string;
}) {
  const id = useId();
  const labelId = `${id}-label`;
  const hintId = hint ? `${id}-hint` : undefined;

  let body = children;
  if (Children.count(children) === 1 && isValidElement(children) && typeof children.type === 'string' && NATIVE.has(children.type)) {
    const props = children.props as Record<string, unknown>;
    body = cloneElement(children as React.ReactElement<Record<string, unknown>>, {
      'aria-labelledby': props['aria-label'] ? undefined : (props['aria-labelledby'] ?? labelId),
      'aria-describedby': props['aria-describedby'] ?? hintId,
    });
  }

  return (
    <div>
      <label id={labelId} className={labelClassName}>{label}</label>
      <FieldIds.Provider value={{ labelId, hintId }}>{body}</FieldIds.Provider>
      {hint && <p id={hintId} className={hintClassName}>{hint}</p>}
    </div>
  );
}
