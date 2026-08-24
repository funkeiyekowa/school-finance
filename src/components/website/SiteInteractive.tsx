"use client";

/**
 * Client-side interactivity for the public school website.
 *
 * Provides scroll-reveal animations, mobile nav toggle, and header
 * scroll shadow — progressively enhanced so the site is fully usable
 * without JS (server-rendered HTML + CSS stands alone).
 */

import { useEffect } from "react";

export function SiteInteractive() {
  useEffect(() => {
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // --- Header scroll shadow ---
    const header = document.querySelector<HTMLElement>(".site-header");
    if (header) {
      const onScroll = () => {
        header.classList.toggle("is-scrolled", window.scrollY > 10);
      };
      window.addEventListener("scroll", onScroll, { passive: true });
      onScroll();
    }

    // --- Mobile nav toggle ---
    const toggle = document.querySelector<HTMLButtonElement>(".nav-toggle");
    const mobileNav = document.querySelector<HTMLElement>(".mobile-nav");
    if (toggle && mobileNav) {
      toggle.addEventListener("click", () => {
        const expanded = toggle.getAttribute("aria-expanded") === "true";
        toggle.setAttribute("aria-expanded", String(!expanded));
        mobileNav.classList.toggle("is-open", !expanded);
      });
    }

    // --- Scroll reveal (skip if user prefers reduced motion) ---
    if (!prefersReduced) {
      const reveals = document.querySelectorAll<HTMLElement>(".reveal");
      if (reveals.length > 0 && "IntersectionObserver" in window) {
        const observer = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (entry.isIntersecting) {
                entry.target.classList.add("is-visible");
                observer.unobserve(entry.target);
              }
            });
          },
          { rootMargin: "0px 0px -60px 0px", threshold: 0.1 }
        );
        reveals.forEach((el) => observer.observe(el));
        return () => observer.disconnect();
      }
    } else {
      // Immediately show all reveal elements
      document.querySelectorAll<HTMLElement>(".reveal").forEach((el) => {
        el.classList.add("is-visible");
      });
    }
  }, []);

  return null;
}
