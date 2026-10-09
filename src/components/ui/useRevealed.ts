"use client";

import { useEffect, useRef } from "react";

/**
 * Keep something that has just appeared (a message after a button was pressed) in sight. On a phone,
 * or on a long page, it can appear below or above the part of the screen the person is looking at,
 * and a message nobody sees might as well not have been written.
 *
 * Moves no further than it takes (the nearest edge) and not at all for someone who has asked their
 * device to reduce motion. `signal` is anything that changes with each new result, so that the same
 * message appearing a second time is brought into view again.
 */
export function useRevealed<T extends HTMLElement>(shown: boolean, signal?: unknown) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!shown) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    ref.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "nearest" });
  }, [shown, signal]);
  return ref;
}
