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
    // IMPORTANT: this must never `return` out of the effect early — doing so
    // previously skipped every piece of setup below it (count-up stats,
    // preloader auto-hide, parallax, cursor glow, magnetic buttons, and the
    // testimonial carousel), because a `return` inside a useEffect callback
    // exits the whole callback, not just this block. The observer's cleanup
    // is collected instead and returned once, at the very end of the effect.
    let revealObserver: IntersectionObserver | null = null;
    if (!prefersReduced) {
      const reveals = document.querySelectorAll<HTMLElement>(".reveal");
      if (reveals.length > 0 && "IntersectionObserver" in window) {
        revealObserver = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (entry.isIntersecting) {
                entry.target.classList.add("is-visible");
                revealObserver?.unobserve(entry.target);
              }
            });
          },
          { rootMargin: "0px 0px -60px 0px", threshold: 0.1 }
        );
        reveals.forEach((el) => revealObserver!.observe(el));
      }
    } else {
      // Immediately show all reveal elements
      document.querySelectorAll<HTMLElement>(".reveal").forEach((el) => {
        el.classList.add("is-visible");
      });
    }

    // --- Count-up statistics ---
    const countEls = document.querySelectorAll<HTMLElement>("[data-count]");
    if (countEls.length > 0 && "IntersectionObserver" in window) {
      const animateCount = (el: HTMLElement) => {
        const target = parseInt(el.getAttribute("data-count") || "0", 10);
        const suffix = el.getAttribute("data-suffix") || "";
        if (prefersReduced) { el.textContent = target.toLocaleString() + suffix; return; }
        const duration = 1200;
        let startTime: number | null = null;
        const step = (ts: number) => {
          if (!startTime) startTime = ts;
          const progress = Math.min((ts - startTime) / duration, 1);
          const eased = 1 - Math.pow(1 - progress, 3);
          el.textContent = Math.round(eased * target).toLocaleString() + suffix;
          if (progress < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      };
      const statObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              animateCount(entry.target as HTMLElement);
              statObserver.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.5 }
      );
      countEls.forEach((el) => statObserver.observe(el));
    } else {
      countEls.forEach((el) => {
        const target = parseInt(el.getAttribute("data-count") || "0", 10);
        const suffix = el.getAttribute("data-suffix") || "";
        el.textContent = target.toLocaleString() + suffix;
      });
    }

    // --- Scroll progress bar ---
    const progressBar = document.querySelector<HTMLElement>(".scroll-progress");
    if (progressBar) {
      const updateProgress = () => {
        const doc = document.documentElement;
        const max = doc.scrollHeight - doc.clientHeight;
        progressBar.style.width = max > 0 ? `${(window.scrollY / max) * 100}%` : "0%";
      };
      window.addEventListener("scroll", updateProgress, { passive: true });
      updateProgress();
    }

    // --- Scroll cue hide on scroll ---
    const scrollCue = document.querySelector<HTMLElement>(".scroll-cue");
    if (scrollCue) {
      const hideCue = () => {
        scrollCue.style.opacity = window.scrollY > 100 ? "0" : "1";
      };
      window.addEventListener("scroll", hideCue, { passive: true });
    }

    // --- Preloader auto-hide ---
    const preloader = document.querySelector<HTMLElement>("[data-site-preloader]");
    if (preloader) {
      const hidePreloader = () => preloader.classList.add("is-hidden");
      if (prefersReduced) {
        hidePreloader();
      } else if (document.readyState === "complete") {
        window.setTimeout(hidePreloader, 300);
      } else {
        window.addEventListener("load", () => window.setTimeout(hidePreloader, 450), { once: true });
      }
    }

    // --- Hero parallax weave ---
    const heroEl = document.querySelector<HTMLElement>(".hero");
    if (heroEl && !prefersReduced) {
      const updateParallax = () => {
        const offset = Math.min(window.scrollY * 0.15, 60);
        heroEl.style.setProperty("--hero-parallax", `${offset}px`);
      };
      window.addEventListener("scroll", updateParallax, { passive: true });
      updateParallax();
    }

    const supportsFinePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

    // --- Cursor glow (desktop pointer only) ---
    const cursorGlow = document.querySelector<HTMLElement>("[data-cursor-glow]");
    if (cursorGlow && supportsFinePointer && !prefersReduced) {
      let glowX = 0, glowY = 0, targetX = 0, targetY = 0, active = false, rafId: number | null = null;
      const tick = () => {
        glowX += (targetX - glowX) * 0.18;
        glowY += (targetY - glowY) * 0.18;
        cursorGlow.style.transform = `translate(${glowX}px,${glowY}px) translate(-50%,-50%)`;
        if (Math.abs(targetX - glowX) > 0.4 || Math.abs(targetY - glowY) > 0.4) {
          rafId = requestAnimationFrame(tick);
        } else {
          rafId = null;
        }
      };
      document.addEventListener("mousemove", (e) => {
        targetX = e.clientX; targetY = e.clientY;
        if (!active) {
          active = true; glowX = targetX; glowY = targetY;
          cursorGlow.classList.add("is-active");
        }
        if (!rafId) rafId = requestAnimationFrame(tick);
      }, { passive: true });
      document.addEventListener("mouseleave", () => cursorGlow.classList.remove("is-active"));
      document.addEventListener("mouseover", (e) => {
        const t = e.target as HTMLElement;
        if (t.closest?.("a,button,.btn")) cursorGlow.classList.add("is-hovering");
      });
      document.addEventListener("mouseout", (e) => {
        const t = e.target as HTMLElement;
        if (t.closest?.("a,button,.btn")) cursorGlow.classList.remove("is-hovering");
      });
    }

    // --- Magnetic buttons (desktop pointer only) ---
    if (supportsFinePointer && !prefersReduced) {
      document.querySelectorAll<HTMLElement>(".js-magnetic").forEach((btn) => {
        const strength = 16;
        btn.addEventListener("mousemove", (e) => {
          const rect = btn.getBoundingClientRect();
          const relX = e.clientX - rect.left - rect.width / 2;
          const relY = e.clientY - rect.top - rect.height / 2;
          btn.style.transition = "transform .06s linear";
          btn.style.transform = `translate(${(relX / rect.width) * strength}px,${(relY / rect.height) * strength}px)`;
        });
        btn.addEventListener("mouseleave", () => {
          btn.style.transition = "transform .35s cubic-bezier(.22,.61,.32,1)";
          btn.style.transform = "translate(0,0)";
        });
      });
    }

    // --- Testimonial carousel(s) ---
    const carousels = document.querySelectorAll<HTMLElement>("[data-testimonial-carousel]");
    const carouselTimers: number[] = [];
    carousels.forEach((root) => {
      const slides = root.querySelectorAll<HTMLElement>(".testimonial-slide");
      const dots = root.querySelectorAll<HTMLButtonElement>("[data-carousel-dot]");
      const prevBtn = root.querySelector<HTMLButtonElement>("[data-carousel-prev]");
      const nextBtn = root.querySelector<HTMLButtonElement>("[data-carousel-next]");
      if (slides.length === 0) return;
      let current = 0;
      let timer: number | null = null;

      const goTo = (i: number) => {
        slides[current]?.classList.remove("is-active");
        dots[current]?.classList.remove("is-active");
        current = (i + slides.length) % slides.length;
        slides[current]?.classList.add("is-active");
        dots[current]?.classList.add("is-active");
      };
      const resetTimer = () => {
        if (timer) window.clearInterval(timer);
        if (prefersReduced) return;
        timer = window.setInterval(() => goTo(current + 1), 6500);
        carouselTimers.push(timer);
      };

      dots.forEach((dot, i) => {
        dot.addEventListener("click", () => { goTo(i); resetTimer(); });
      });
      prevBtn?.addEventListener("click", () => { goTo(current - 1); resetTimer(); });
      nextBtn?.addEventListener("click", () => { goTo(current + 1); resetTimer(); });
      root.addEventListener("mouseenter", () => { if (timer) window.clearInterval(timer); });
      root.addEventListener("mouseleave", resetTimer);
      root.addEventListener("focusin", () => { if (timer) window.clearInterval(timer); });
      root.addEventListener("focusout", resetTimer);
      resetTimer();
    });

    return () => {
      revealObserver?.disconnect();
      carouselTimers.forEach((t) => window.clearInterval(t));
    };
  }, []);

  return null;
}
