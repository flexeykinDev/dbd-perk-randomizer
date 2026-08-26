"use client";

import { Component, type ReactNode } from "react";

/* React has no hook form of this — catching a render error still requires a
 * class, and that is the only reason this file is one.
 *
 * Why it exists at all: the site is a static export, so there is no server to
 * fall back to. Before this, a throw anywhere in the tree — a malformed
 * override entry, a description bundle that came back null, a WebGL context
 * that would not initialise — unmounted everything and left a white page with
 * no way back except a manual reload. app/error.tsx now catches that at the
 * route level; this catches it closer to the fault, so a broken canvas costs
 * the canvas rather than the page. */

interface Props {
  children: ReactNode;
  /** What to show instead. A function receives a `retry` that clears the
   *  error and re-mounts the subtree — worth offering when the fault may be
   *  transient (a lost GPU context, a failed fetch), pointless when it is
   *  not. */
  fallback: ReactNode | ((retry: () => void) => ReactNode);
  /** Reported so a fault is visible in the console rather than swallowed
   *  into a silently degraded UI. */
  label: string;
}

interface State {
  failed: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    // Degrading quietly is the point of this component, but degrading
    // *invisibly* is how the inert-override bug survived for weeks. Anything
    // this catches should still be findable.
    console.error(`[${this.props.label}] rendering failed:`, error);
  }

  retry = () => this.setState({ failed: false });

  render() {
    if (!this.state.failed) return this.props.children;
    const { fallback } = this.props;
    return typeof fallback === "function" ? fallback(this.retry) : fallback;
  }
}
