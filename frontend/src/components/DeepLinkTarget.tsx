"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { deepLinkEventName, deepLinkHighlightClass } from "@/lib/deepLink";

// Sections appear only once their page has loaded its data, so give the DOM a
// while to produce the target before giving up.
const resolveTimeoutMs = 10_000;
const highlightDurationMs = 2_500;

// Resolves the URL fragment carried by notification links: scrolls the matching
// section into the shell's scroll container and flags it briefly. Mounted once
// per shell so every page gets the behaviour without its own wiring.
export default function DeepLinkTarget() {
  const pathname = usePathname();
  const [signal, setSignal] = useState(0);

  useEffect(() => {
    function rerun() {
      setSignal((value) => value + 1);
    }

    window.addEventListener(deepLinkEventName, rerun);
    window.addEventListener("hashchange", rerun);
    return () => {
      window.removeEventListener(deepLinkEventName, rerun);
      window.removeEventListener("hashchange", rerun);
    };
  }, []);

  useEffect(() => {
    const targetId = decodeURIComponent(window.location.hash.slice(1));
    if (!targetId) return;

    let observer: MutationObserver | null = null;
    let deadlineTimer = 0;
    let highlightTimer = 0;
    let highlighted: HTMLElement | null = null;

    function stopWatching() {
      observer?.disconnect();
      observer = null;
      window.clearTimeout(deadlineTimer);
    }

    function resolve() {
      const element = document.getElementById(targetId);
      if (!element) return;

      stopWatching();
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      element.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
      element.classList.add(deepLinkHighlightClass);
      highlighted = element;
      highlightTimer = window.setTimeout(() => {
        element.classList.remove(deepLinkHighlightClass);
        highlighted = null;
      }, highlightDurationMs);
    }

    resolve();
    if (!highlighted) {
      observer = new MutationObserver(resolve);
      observer.observe(document.body, { childList: true, subtree: true });
      deadlineTimer = window.setTimeout(stopWatching, resolveTimeoutMs);
    }

    return () => {
      stopWatching();
      window.clearTimeout(highlightTimer);
      highlighted?.classList.remove(deepLinkHighlightClass);
    };
  }, [pathname, signal]);

  return null;
}
