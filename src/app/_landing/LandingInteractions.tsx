"use client";

import { useEffect } from "react";

/**
 * Progressive-enhancement client shim for the premium landing page.
 * - Sticky header scroll state
 * - Mobile nav toggle
 * - Reveal-on-scroll
 * - Number count-ups
 * - Pulse ring fill
 * - FAQ accordion
 */
export default function LandingInteractions() {
  useEffect(() => {
    // header scroll state
    const header = document.getElementById("siteHeader");
    const onScroll = () => header?.classList.toggle("scrolled", window.scrollY > 8);
    document.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    // mobile nav
    const toggle = document.getElementById("navToggle");
    const panel = document.getElementById("mobilePanel");
    const onToggle = () => {
      const open = panel?.classList.toggle("open");
      toggle?.setAttribute("aria-expanded", String(!!open));
    };
    toggle?.addEventListener("click", onToggle);
    const panelLinks = panel?.querySelectorAll("a") ?? [];
    const closePanel = () => {
      panel?.classList.remove("open");
      toggle?.setAttribute("aria-expanded", "false");
    };
    panelLinks.forEach((a) => a.addEventListener("click", closePanel));

    // reveal on scroll
    const revealEls = document.querySelectorAll(".reveal");
    let io: IntersectionObserver | null = null;
    if ("IntersectionObserver" in window) {
      io = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            if (e.isIntersecting) {
              e.target.classList.add("is-visible");
              io?.unobserve(e.target);
            }
          });
        },
        { threshold: 0.14, rootMargin: "0px 0px -40px 0px" },
      );
      revealEls.forEach((el) => io?.observe(el));
    } else {
      revealEls.forEach((el) => el.classList.add("is-visible"));
    }

    // count-up numbers
    const counters = document.querySelectorAll<HTMLElement>("[data-count-to]");
    const animateCount = (el: HTMLElement) => {
      const target = parseFloat(el.getAttribute("data-count-to") || "0");
      const dur = 1400;
      let start: number | null = null;
      const step = (ts: number) => {
        if (!start) start = ts;
        const p = Math.min((ts - start) / dur, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        el.textContent = String(Math.round(target * eased));
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };
    let cio: IntersectionObserver | null = null;
    if ("IntersectionObserver" in window) {
      cio = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            if (e.isIntersecting) {
              animateCount(e.target as HTMLElement);
              cio?.unobserve(e.target);
            }
          });
        },
        { threshold: 0.6 },
      );
      counters.forEach((el) => cio?.observe(el));
    } else {
      counters.forEach((el) => (el.textContent = el.getAttribute("data-count-to") ?? ""));
    }

    // hero ring fill animation
    const ringData: [string, number, number][] = [
      ["ringGold", 478, 0.92],
      ["ringSage", 365, 0.96],
      ["ringBlue", 251, 0.88],
    ];
    const ringWrap = document.querySelector(".ring-wrap");
    const fillRings = () => {
      ringData.forEach((r) => {
        const el = document.getElementById(r[0]);
        if (el) (el as unknown as SVGCircleElement).style.strokeDasharray = `${r[1] * r[2]} ${r[1]}`;
      });
    };
    let rio: IntersectionObserver | null = null;
    if (ringWrap && "IntersectionObserver" in window) {
      rio = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            if (e.isIntersecting) {
              fillRings();
              rio?.unobserve(e.target);
            }
          });
        },
        { threshold: 0.4 },
      );
      rio.observe(ringWrap);
    } else if (ringWrap) {
      fillRings();
    }

    // faq accordion
    const faqCleanups: Array<() => void> = [];
    document.querySelectorAll(".faq-item").forEach((item) => {
      const btn = item.querySelector<HTMLButtonElement>(".faq-q");
      const panelEl = item.querySelector<HTMLElement>(".faq-a");
      if (!btn || !panelEl) return;
      const handler = () => {
        const isOpen = item.classList.contains("open");
        document.querySelectorAll(".faq-item.open").forEach((o) => {
          if (o !== item) {
            o.classList.remove("open");
            o.querySelector(".faq-q")?.setAttribute("aria-expanded", "false");
            const inner = o.querySelector<HTMLElement>(".faq-a");
            if (inner) inner.style.maxHeight = "";
          }
        });
        item.classList.toggle("open", !isOpen);
        btn.setAttribute("aria-expanded", String(!isOpen));
        panelEl.style.maxHeight = !isOpen ? panelEl.scrollHeight + "px" : "";
      };
      btn.addEventListener("click", handler);
      faqCleanups.push(() => btn.removeEventListener("click", handler));
    });

    return () => {
      document.removeEventListener("scroll", onScroll);
      toggle?.removeEventListener("click", onToggle);
      panelLinks.forEach((a) => a.removeEventListener("click", closePanel));
      io?.disconnect();
      cio?.disconnect();
      rio?.disconnect();
      faqCleanups.forEach((fn) => fn());
    };
  }, []);

  return null;
}
