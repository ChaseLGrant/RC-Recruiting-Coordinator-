"use client";
import { useEffect } from "react";

/** Lands at the top of the page (a form submitted from far down the previous page keeps its scroll otherwise). */
export function ScrollTop() {
  useEffect(() => { window.scrollTo(0, 0); }, []);
  return null;
}
