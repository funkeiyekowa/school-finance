import type { Metadata } from "next";
import { createClient as createServerClient } from "@/lib/supabase/server";
import LandingInteractions from "./_landing/LandingInteractions";
import "./_landing/landing.css";

export const metadata: Metadata = {
  title: "Smart & Thrive O/S — The operating system for ambitious schools",
  description:
    "Admissions, student finance, attendance, CBT, report cards and a parent-facing website — one connected operating system for your school.",
};

/* Load contact email from platform_settings (Super Admin editable).
   Fallback to env var, then a compile-time default. */
async function loadContactEmail(): Promise<string> {
  const fallback = process.env.NEXT_PUBLIC_LANDING_EMAIL || "hello@smartandthrive.com";
  try {
    const supabase = await createServerClient();
    const { data, error } = await supabase.rpc("get_landing_contact_email");
    if (error || !data) return fallback;
    return String(data);
  } catch {
    return fallback;
  }
}

const LIVE_URL = "/s/grant-schools";

/* ----------------------------------------------------------------- */
/*  Icon primitives                                                  */
/* ----------------------------------------------------------------- */
function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
function ArrowRight() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

export default async function LandingPage() {
  const CONTACT_EMAIL = await loadContactEmail();
  const mailto = (subject: string) =>
    `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`;

  return (
    <div className="st-landing">
      <a className="skip-link" href="#main">Skip to content</a>

      <header className="site-header" id="siteHeader">
        <div className="nav-wrap">
          <a className="brand" href="#top" aria-label="Smart & Thrive O/S home">
            <span className="brand-mark" aria-hidden="true">
              <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" />
                <path d="M20 2v4" /><path d="M22 4h-4" /><circle cx={4} cy={20} r={2} />
              </svg>
            </span>
            <span className="brand-name">Smart &amp; Thrive <em>O/S</em></span>
          </a>
          <nav className="main-nav" aria-label="Primary">
            <a href="#modules">Modules</a>
            <a href="#how">How it works</a>
            <a href="#security">Security</a>
            <a href="#pricing">Pricing</a>
            <a href="#faq">FAQ</a>
          </nav>
          <div className="header-cta">
            <a className="btn btn-ghost btn-sm" href={LIVE_URL}>See it live</a>
            <a className="btn btn-primary btn-sm" href={mailto("Book a demo - Smart & Thrive O/S")}>Book a demo</a>
            <button className="nav-toggle" id="navToggle" aria-label="Open menu" aria-expanded="false" aria-controls="mobilePanel"><span></span></button>
          </div>
        </div>
        <div className="mobile-panel" id="mobilePanel">
          <div className="mobile-panel-inner">
            <a href="#modules">Modules</a>
            <a href="#how">How it works</a>
            <a href="#security">Security</a>
            <a href="#pricing">Pricing</a>
            <a href="#faq">FAQ</a>
            <a href={LIVE_URL}>See it live</a>
            <a className="btn btn-primary btn-block" href={mailto("Book a demo - Smart & Thrive O/S")}>Book a demo</a>
          </div>
        </div>
      </header>

      <main id="main">
        {/* ============ HERO ============ */}
        <section className="hero" id="top">
          <div className="container hero-grid">
            <div className="hero-copy reveal is-visible">
              <span className="eyebrow">The operating system for ambitious schools</span>
              <h1>Run your school <span className="italic-accent">the way it should feel</span> to run one.</h1>
              <p className="hero-sub">Admissions, finance, attendance, CBT, report cards and a parent portal — one connected suite, built for the way real schools actually work.</p>
              <div className="hero-ctas">
                <a className="btn btn-gold" href={mailto("Book a demo - Smart & Thrive O/S")}>Book a demo<ArrowRight /></a>
                <a className="btn btn-ghost" href={LIVE_URL}>See it live</a>
              </div>
              <p className="hero-note">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                No credit card. We set up your first school in under a week.
              </p>
            </div>

            <div className="hero-visual reveal reveal-2 is-visible">
              <div className="pulse-glow" aria-hidden="true"></div>
              <div className="pulse-card">
                <div className="pulse-top">
                  <span className="pulse-eyebrow">Today at your school</span>
                  <span className="pulse-live"><span className="pulse-dot"></span>Live</span>
                </div>
                <div className="pulse-body">
                  <div className="ring-wrap" aria-hidden="true">
                    <svg viewBox="0 0 172 172">
                      <circle className="ring-track" cx={86} cy={86} r={76} stroke="rgba(201,162,39,0.14)" />
                      <circle className="ring-val" id="ringGold" cx={86} cy={86} r={76} stroke="#C9A227" style={{ strokeDasharray: "0 478" }} />
                      <circle className="ring-track" cx={86} cy={86} r={58} stroke="rgba(78,99,80,0.14)" />
                      <circle className="ring-val" id="ringSage" cx={86} cy={86} r={58} stroke="#4E6350" style={{ strokeDasharray: "0 365" }} />
                      <circle className="ring-track" cx={86} cy={86} r={40} stroke="rgba(47,90,134,0.14)" />
                      <circle className="ring-val" id="ringBlue" cx={86} cy={86} r={40} stroke="#2F5A86" style={{ strokeDasharray: "0 251" }} />
                    </svg>
                    <div className="ring-center">
                      <span className="num" data-count-to="94">0</span>
                      <span className="lbl">Term Pulse</span>
                    </div>
                  </div>
                  <div className="pulse-legend">
                    <div className="leg-item"><span className="leg-dot" style={{ background: "#C9A227" }}></span><div className="leg-text"><div className="t">Fees collected</div><div className="s">This term, all classes</div></div><span className="leg-pct">92%</span></div>
                    <div className="leg-item"><span className="leg-dot" style={{ background: "#4E6350" }}></span><div className="leg-text"><div className="t">Attendance today</div><div className="s">1,240 students checked in</div></div><span className="leg-pct">96%</span></div>
                    <div className="leg-item"><span className="leg-dot" style={{ background: "#2F5A86" }}></span><div className="leg-text"><div className="t">Reports published</div><div className="s">JSS2, all subjects</div></div><span className="leg-pct">88%</span></div>
                  </div>
                </div>
                <div className="pulse-foot">
                  <div className="foot-stat"><div className="v">₦2.4M</div><div className="k">Collected this term</div></div>
                  <div className="foot-stat"><div className="v">6</div><div className="k">Modules, one login</div></div>
                  <div className="foot-stat"><div className="v">3</div><div className="k">Reports pending</div></div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ============ TRUST ============ */}
        <section className="section" style={{ paddingTop: 0 }}>
          <div className="container">
            <div className="trust-line reveal">
              <span className="eyebrow" style={{ justifyContent: "center" }}>Trusted across the region</span>
              <p>From single-campus primaries to multi-campus groups, schools run their whole term inside Smart &amp; Thrive.</p>
            </div>
            <div className="logo-row reveal reveal-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <span key={i} className="logo-chip">Your school here</span>
              ))}
            </div>
            <div className="gallery reveal reveal-3">
              <figure className="g1 ph">
                <img src="https://images.unsplash.com/photo-1638920329718-ad6f890bb311?auto=format&fit=crop&w=900&q=80" alt="A stately school building with a clock tower, representing an established institution." />
                <figcaption>One campus or twelve.</figcaption>
              </figure>
              <figure className="g2 ph">
                <img src="https://images.unsplash.com/photo-1740635341299-3b8e3490f546?auto=format&fit=crop&w=800&q=80" alt="A bright, modern classroom filled with rows of desks and chairs." />
                <figcaption>Admissions mornings, calmer.</figcaption>
              </figure>
              <figure className="g3 ph">
                <img src="https://images.unsplash.com/photo-1758270704524-596810e891b5?auto=format&fit=crop&w=800&q=80" alt="Students smiling and engaged in a lecture hall." />
                <figcaption>Assessments, accounted for.</figcaption>
              </figure>
            </div>
          </div>
        </section>

        {/* ============ NARRATIVE ============ */}
        <section className="section">
          <div className="container">
            <div className="narrative-head reveal">
              <span className="eyebrow">The old way, and the better one</span>
              <h2>Stop running your school on seven half-broken tools.</h2>
              <p>The average school runs on a spreadsheet, a WhatsApp group and hope. There&apos;s a better way — and it starts with everyone reading from the same record.</p>
            </div>
            <div className="chapters reveal reveal-2">
              <div className="chapter">
                <span className="num">01 — Where most schools start</span>
                <h3>Fragmented tools</h3>
                <p>One system for finance, another for reports, a third for the parent group. Nothing talks to anything, and every term someone reconciles it all by hand.</p>
              </div>
              <div className="chapter is-solution">
                <span className="num">02 — What changes</span>
                <h3>One connected suite</h3>
                <p>Every module reads the same students, classes and ledgers. Change something once, and it changes everywhere — no re-entry, no drift.</p>
              </div>
              <div className="chapter">
                <span className="num">03 — What you get</span>
                <h3>Real-time visibility</h3>
                <p>Head-of-school dashboards show fees collected, attendance today and pending report cards — right now, not at end of term.</p>
              </div>
            </div>
          </div>
        </section>

        {/* ============ STAT BAND ============ */}
        <section className="stat-band">
          <div className="container">
            <div className="stat-grid">
              <div className="stat-item reveal is-visible"><div className="num" data-count-to="6">0</div><div className="lbl">Modules included in every plan — no locked add-ons</div></div>
              <div className="stat-item reveal reveal-2 is-visible"><div className="num">&lt;7</div><div className="lbl">Days from signed-up to fully live</div></div>
              <div className="stat-item reveal reveal-3 is-visible"><div className="num" data-count-to="0">0</div><div className="lbl">Spreadsheets required to run your term</div></div>
              <div className="stat-item reveal reveal-4 is-visible"><div className="num">24/7</div><div className="lbl">Parent visibility into fees, attendance &amp; reports</div></div>
            </div>
          </div>
        </section>

        {/* ============ MODULES ============ */}
        <section className="section" id="modules">
          <div className="container">
            <div className="modules-head reveal">
              <span className="eyebrow" style={{ justifyContent: "center" }}>Six modules. One codebase.</span>
              <h2>Everything your term touches, in one place.</h2>
              <p>Turn on what you need today. Every module is included in the base subscription — no module locks, no surprise upsells.</p>
            </div>

            {/* Module 1: Admissions */}
            <div className="module-row reveal">
              <div className="m-media">
                <div className="m-mock">
                  <div className="m-mock-head"><span className="t">Admissions pipeline</span><div className="m-dots"><span></span><span></span><span></span></div></div>
                  <div className="kanban">
                    <div className="kanban-col"><div className="ct">Enquiry</div>
                      <div className="kanban-card"><div className="nm">A. Bello</div><span className="tg">New</span></div>
                      <div className="kanban-card"><div className="nm">T. Okafor</div><span className="tg">New</span></div>
                    </div>
                    <div className="kanban-col"><div className="ct">Interview</div>
                      <div className="kanban-card"><div className="nm">C. Nwosu</div><span className="tg">Fri 10am</span></div>
                    </div>
                    <div className="kanban-col"><div className="ct">Offer</div>
                      <div className="kanban-card"><div className="nm">R. Danjuma</div><span className="tg">Sent</span></div>
                    </div>
                    <div className="kanban-col"><div className="ct">Enrolled</div>
                      <div className="kanban-card"><div className="nm">M. Ibe</div><span className="tg">Paid</span></div>
                    </div>
                  </div>
                </div>
                <div className="m-photo"><img src="https://images.unsplash.com/photo-1719159381981-1327b22aff9b?auto=format&fit=crop&w=300&q=80" alt="An admissions team member reviewing applications on a laptop." /></div>
              </div>
              <div className="m-copy">
                <span className="m-index">01</span>
                <h3>Admissions &amp; Enquiries</h3>
                <p>Capture every lead, guide it through interview, offer and enrolment — no lost prospects, no forgotten follow-ups.</p>
                <ul className="m-list">
                  <li><CheckIcon />Enquiry pipeline with clear stages</li>
                  <li><CheckIcon />Automated follow-up reminders</li>
                  <li><CheckIcon />Interview scheduling built in</li>
                  <li><CheckIcon />Offer letters &amp; enrolment in one click</li>
                </ul>
                <a className="m-link" href="#pricing">Learn more <ArrowRight /></a>
              </div>
            </div>

            {/* Module 2: Finance */}
            <div className="module-row flip reveal">
              <div className="m-media">
                <div className="m-mock">
                  <div className="m-mock-head"><span className="t">Student finance</span><div className="m-dots"><span></span><span></span><span></span></div></div>
                  <div className="ledger-row"><div className="ledger-av">CN</div><div className="ledger-mid"><div className="n">Chidi Nwosu</div><div className="c">JSS 2B</div></div><div className="ledger-amt">₦85,000</div><span className="pill paid">Paid</span></div>
                  <div className="ledger-row"><div className="ledger-av">AB</div><div className="ledger-mid"><div className="n">Amara Bello</div><div className="c">SS 1A</div></div><div className="ledger-amt">₦62,000</div><span className="pill pending">Pending</span></div>
                  <div className="ledger-row"><div className="ledger-av">TO</div><div className="ledger-mid"><div className="n">Tunde Okoye</div><div className="c">Primary 5</div></div><div className="ledger-amt">₦48,000</div><span className="pill paid">Paid</span></div>
                  <div className="ledger-bar"><span style={{ width: "92%" }}></span></div>
                  <div className="ledger-foot"><span>Collected: ₦2.4M</span><span>92% of term</span></div>
                </div>
                <div className="m-photo"><img src="https://images.unsplash.com/photo-1606761568499-6d2451b23c66?auto=format&fit=crop&w=300&q=80" alt="A school finance officer reconciling accounts at a desk." /></div>
              </div>
              <div className="m-copy">
                <span className="m-index">02</span>
                <h3>Student Finance</h3>
                <p>Fees, invoicing, receipts and per-child ledgers with bank reconciliation baked in — collections without the spreadsheet gymnastics.</p>
                <ul className="m-list">
                  <li><CheckIcon />Per-child fee ledger, always current</li>
                  <li><CheckIcon />Auto-generated invoices &amp; receipts</li>
                  <li><CheckIcon />Bank &amp; POS reconciliation</li>
                  <li><CheckIcon />Outstanding-balance alerts to parents</li>
                </ul>
                <a className="m-link" href="#pricing">Learn more <ArrowRight /></a>
              </div>
            </div>

            {/* Module 3: Attendance */}
            <div className="module-row reveal">
              <div className="m-media">
                <div className="m-mock">
                  <div className="m-mock-head"><span className="t">Attendance — SS1A</span><div className="m-dots"><span></span><span></span><span></span></div></div>
                  <div className="att-grid">
                    {[
                      "on","on","on","off","on","on","on","on",
                      "on","on","off","on","on","on","on","on",
                    ].map((s, i) => <div key={i} className={`att-dot ${s}`}></div>)}
                  </div>
                  <div className="att-summary"><div><div className="v">96%</div><div className="k">present today</div></div><div><div className="v">96</div><div className="k">Of 40 registered</div></div></div>
                </div>
                <div className="m-photo"><img src="https://images.unsplash.com/photo-1577896851231-70ef18881754?auto=format&fit=crop&w=300&q=80" alt="A teacher taking the daily register in front of her class." /></div>
              </div>
              <div className="m-copy">
                <span className="m-index">03</span>
                <h3>Attendance &amp; Assessments</h3>
                <p>Daily register, per-subject scores and term-end grade books — one workflow that teachers actually keep up with.</p>
                <ul className="m-list">
                  <li><CheckIcon />Daily register in under 60 seconds</li>
                  <li><CheckIcon />Per-subject continuous assessment</li>
                  <li><CheckIcon />Automatic grade book roll-up</li>
                  <li><CheckIcon />Absence alerts sent to parents</li>
                </ul>
                <a className="m-link" href="#pricing">Learn more <ArrowRight /></a>
              </div>
            </div>

            {/* Module 4: CBT */}
            <div className="module-row flip reveal">
              <div className="m-media">
                <div className="m-mock">
                  <div className="m-mock-head"><span className="t">CBT — Mathematics</span><span className="cbt-timer">⏱ 18:42</span></div>
                  <p className="cbt-q">Q7. A train travels 240km in 3 hours. What is its average speed?</p>
                  <div className="cbt-opt"><span className="cbt-radio"></span>60 km/h</div>
                  <div className="cbt-opt sel"><span className="cbt-radio"></span>80 km/h</div>
                  <div className="cbt-opt"><span className="cbt-radio"></span>100 km/h</div>
                  <div className="cbt-progress">
                    <span className="done"></span><span className="done"></span><span className="done"></span><span className="done"></span><span className="done"></span><span className="done"></span><span className="done"></span><span></span><span></span><span></span>
                  </div>
                </div>
                <div className="m-photo"><img src="https://images.unsplash.com/photo-1568585219057-9206080e6c74?auto=format&fit=crop&w=300&q=80" alt="A student sitting a computer-based test on a tablet." /></div>
              </div>
              <div className="m-copy">
                <span className="m-index">04</span>
                <h3>CBT / Online Exams</h3>
                <p>Timed, secure computer-based tests. Objectives auto-mark themselves and every attempt is tracked and logged.</p>
                <ul className="m-list">
                  <li><CheckIcon />Timed, lockdown-style testing</li>
                  <li><CheckIcon />Auto-marking for objective questions</li>
                  <li><CheckIcon />Question bank with randomisation</li>
                  <li><CheckIcon />Attempt &amp; integrity logs</li>
                </ul>
                <a className="m-link" href="#pricing">Learn more <ArrowRight /></a>
              </div>
            </div>

            {/* Module 5: Report cards */}
            <div className="module-row reveal">
              <div className="m-media">
                <div className="m-mock">
                  <div className="m-mock-head"><span className="t">Term report</span><div className="m-dots"><span></span><span></span><span></span></div></div>
                  <div className="rc-card">
                    <div className="rc-head"><div className="rc-crest"></div><div><div className="n">Amaka Eze</div><div className="s">SS 2 · Third Term</div></div></div>
                    <div className="rc-row"><span>Mathematics</span><span className="g">A</span></div>
                    <div className="rc-row"><span>English Language</span><span className="g">B+</span></div>
                    <div className="rc-row"><span>Biology</span><span className="g">A</span></div>
                    <div className="rc-remark">&ldquo;Consistent, focused, a pleasure to teach.&rdquo; — Form Teacher</div>
                  </div>
                </div>
                <div className="m-photo"><img src="https://images.unsplash.com/photo-1758612898701-e2f2958f219d?auto=format&fit=crop&w=300&q=80" alt="A student writing carefully in a notebook at their desk." /></div>
              </div>
              <div className="m-copy">
                <span className="m-index">05</span>
                <h3>Report Cards</h3>
                <p>One-click term reports with your school&apos;s branding, teacher remarks and cumulative averages — ready the same night results are entered.</p>
                <ul className="m-list">
                  <li><CheckIcon />Your school&apos;s branding &amp; layout</li>
                  <li><CheckIcon />Teacher remarks &amp; cumulative averages</li>
                  <li><CheckIcon />Bulk generate &amp; publish in minutes</li>
                  <li><CheckIcon />Instant access for parents</li>
                </ul>
                <a className="m-link" href="#pricing">Learn more <ArrowRight /></a>
              </div>
            </div>

            {/* Module 6: Parent portal */}
            <div className="module-row flip reveal">
              <div className="m-media" style={{ display: "flex", justifyContent: "center" }}>
                <div className="m-mock" style={{ width: "fit-content" }}>
                  <div className="m-mock-head" style={{ justifyContent: "center", marginBottom: 12 }}><span className="t">Parent portal</span></div>
                  <div className="phone-frame">
                    <div className="phone-screen">
                      <div className="ps-bal"><div className="k">Outstanding balance</div><div className="v">₦0.00</div></div>
                      <div className="ps-row"><span>Attendance (term)</span><span>98%</span></div>
                      <div className="ps-row"><span>Latest report</span><span>Published</span></div>
                      <div className="ps-btn">View report card</div>
                    </div>
                  </div>
                </div>
                <div className="m-photo"><img src="https://images.unsplash.com/photo-1603354350317-6f7aaa5911c5?auto=format&fit=crop&w=300&q=80" alt="A parent viewing the school portal on a tablet." /></div>
              </div>
              <div className="m-copy">
                <span className="m-index">06</span>
                <h3>Website &amp; Parent Portal</h3>
                <p>Publish your public site and give every parent a private dashboard from the same data — fees, attendance and reports, in one place.</p>
                <ul className="m-list">
                  <li><CheckIcon />Public site, no developer needed</li>
                  <li><CheckIcon />Private dashboard per family</li>
                  <li><CheckIcon />Fees, attendance &amp; reports together</li>
                  <li><CheckIcon />Works beautifully on any phone</li>
                </ul>
                <a className="m-link" href="#pricing">Learn more <ArrowRight /></a>
              </div>
            </div>
          </div>
        </section>

        {/* ============ HOW IT WORKS ============ */}
        <section className="section how" id="how">
          <div className="container">
            <div className="narrative-head reveal">
              <span className="eyebrow">How it works</span>
              <h2>From zero to live in four steps.</h2>
            </div>
            <div className="how-grid">
              <div className="how-step reveal reveal-1"><div className="how-num">01</div><h3>We provision your school</h3><p>Your organisation, domain and brand colours are set up — you don&apos;t touch a config file.</p></div>
              <div className="how-step reveal reveal-2"><div className="how-num">02</div><h3>Import your students</h3><p>Bring in your existing roster from a spreadsheet. We map classes, guardians and IDs.</p></div>
              <div className="how-step reveal reveal-3"><div className="how-num">03</div><h3>Auto-provision accounts</h3><p>Every student gets a code, every parent an email invite, every teacher a staff login.</p></div>
              <div className="how-step reveal reveal-4"><div className="how-num">04</div><h3>Go live</h3><p>Your public site is up, the portal is open, and receipts start flowing in on day one.</p></div>
            </div>
          </div>
        </section>

        {/* ============ SECURITY ============ */}
        <section className="section security" id="security">
          <div className="container">
            <div className="security-top reveal">
              <span className="eyebrow on-dark">Built to be trusted with the whole term</span>
              <h2>Bank-grade, under the hood.</h2>
              <p>Fee records, exam results and family data deserve more than a shared spreadsheet. Every layer of Smart &amp; Thrive is built for schools that take that seriously.</p>
            </div>
            <div className="sec-grid reveal reveal-2">
              <div className="sec-item">
                <div className="sec-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x={3} y={11} width={18} height={11} rx={2} /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg></div>
                <h3>Encrypted in transit &amp; at rest</h3>
                <p>Every record — fees, results, guardian details — is encrypted end to end, on the wire and in storage.</p>
              </div>
              <div className="sec-item">
                <div className="sec-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx={12} cy={8} r={4} /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></svg></div>
                <h3>Role-based access</h3>
                <p>Teachers see their classes. Finance sees ledgers. Heads of school see everything — nothing more, nothing less.</p>
              </div>
              <div className="sec-item">
                <div className="sec-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3.3-6.95" /><path d="M21 3v6h-6" /></svg></div>
                <h3>Automated daily backups</h3>
                <p>Your term is backed up every day, automatically, with point-in-time restore if you ever need it.</p>
              </div>
              <div className="sec-item">
                <div className="sec-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg></div>
                <h3>Full audit trail</h3>
                <p>Every fee edit, grade change and record update is logged with who, what and when.</p>
              </div>
              <div className="sec-item">
                <div className="sec-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z" /><path d="M2 12h20" /></svg></div>
                <h3>Regional data residency</h3>
                <p>Your school&apos;s data stays close to home, hosted on infrastructure built for reliability in the region.</p>
              </div>
              <div className="sec-item">
                <div className="sec-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z" /></svg></div>
                <h3>Built for a 99.9% uptime target</h3>
                <p>Report card night and fee-deadline morning are exactly when you need the system to hold steady.</p>
              </div>
            </div>
          </div>
        </section>

        {/* ============ INTEGRATIONS ============ */}
        <section className="section">
          <div className="container">
            <div className="integrations-head reveal">
              <span className="eyebrow" style={{ justifyContent: "center" }}>Fits into what you already use</span>
              <h2>No rip-and-replace required.</h2>
            </div>
            <div className="badge-row reveal reveal-2">
              <span className="badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x={2} y={5} width={20} height={14} rx={2} /><path d="M2 10h20" /></svg>Bank transfer &amp; POS reconciliation</span>
              <span className="badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>SMS &amp; WhatsApp alerts</span>
              <span className="badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>Excel &amp; CSV import / export</span>
              <span className="badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x={2} y={4} width={20} height={16} rx={2} /><path d="m22 7-10 6L2 7" /></svg>Email notifications</span>
              <span className="badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx={12} cy={12} r={10} /><path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20" /></svg>Google Workspace sign-in</span>
              <span className="badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="m18 16 4-4-4-4M6 8l-4 4 4 4M14.5 4l-5 16" /></svg>Public API for custom workflows</span>
            </div>
          </div>
        </section>

        {/* ============ PRICING ============ */}
        <section className="section" id="pricing">
          <div className="container">
            <div className="pricing-head reveal">
              <span className="eyebrow" style={{ justifyContent: "center" }}>Pricing</span>
              <h2>Simple plans. No module locks.</h2>
              <p>Everything is included in the base subscription. Only the student cap changes as you grow.</p>
            </div>
            <div className="plans reveal reveal-2">
              <div className="plan">
                <h3>Starter</h3>
                <p className="desc">For small schools finding their footing.</p>
                <div className="price-line"><div className="cap">Up to 150 students</div><div className="sub">Get a quote tailored to your school</div></div>
                <ul className="plan-feats">
                  <li><CheckIcon />All six core modules</li>
                  <li><CheckIcon />Standard email support</li>
                  <li><CheckIcon />Community help centre</li>
                  <li><CheckIcon />Guided self-serve setup</li>
                </ul>
                <a className="btn btn-ghost btn-block" href={mailto("Talk to us - Starter plan")}>Talk to us</a>
              </div>
              <div className="plan feat">
                <span className="plan-badge">Most popular</span>
                <h3>Growth</h3>
                <p className="desc">For established schools scaling up.</p>
                <div className="price-line"><div className="cap">Up to 500 students</div><div className="sub">Get a quote tailored to your school</div></div>
                <ul className="plan-feats">
                  <li><CheckIcon />All core modules + CBT</li>
                  <li><CheckIcon />Priority support</li>
                  <li><CheckIcon />Dedicated onboarding session</li>
                  <li><CheckIcon />Advanced finance reporting</li>
                </ul>
                <a className="btn btn-gold btn-block" href={mailto("Talk to us - Growth plan")}>Talk to us</a>
              </div>
              <div className="plan">
                <h3>Enterprise</h3>
                <p className="desc">Groups, chains and international schools.</p>
                <div className="price-line"><div className="cap">Unlimited students</div><div className="sub">Get a quote tailored to your school</div></div>
                <ul className="plan-feats">
                  <li><CheckIcon />Multi-campus consolidation</li>
                  <li><CheckIcon />Dedicated success manager</li>
                  <li><CheckIcon />Custom SLAs &amp; SSO</li>
                  <li><CheckIcon />Custom contract &amp; invoicing</li>
                </ul>
                <a className="btn btn-ghost btn-block" href={mailto("Talk to us - Enterprise plan")}>Talk to us</a>
              </div>
            </div>
            <p className="pricing-note reveal reveal-3">Every plan is quoted to your student cap. Ask us for a price sheet — no surprises.</p>
          </div>
        </section>

        {/* ============ TESTIMONIAL ============ */}
        <section className="section testimonial">
          <div className="container">
            <div className="quote-wrap reveal">
              <span className="quote-mark" aria-hidden="true">&ldquo;</span>
              <blockquote>Every term used to end in a wall of spreadsheets. Now report cards publish the same night results are entered, and parents can actually find their child&apos;s balance. It&apos;s the calmest term we&apos;ve had.</blockquote>
              <div className="quote-attr">
                <span className="quote-av">MI</span>
                <div><div className="n">Mrs. Iyekowa</div><div className="r">Head of School</div></div>
              </div>
            </div>
          </div>
        </section>

        {/* ============ FAQ ============ */}
        <section className="section" id="faq">
          <div className="container">
            <div className="faq-wrap">
              <div className="faq-head reveal">
                <span className="eyebrow" style={{ justifyContent: "center" }}>Questions</span>
                <h2>Everything you&apos;re probably wondering.</h2>
              </div>
              <div className="faq-list reveal reveal-2">
                {[
                  { q: "How long does setup actually take?", a: "Most schools are fully live within a week of signing up. We provision your organisation, import your existing roster, and auto-generate logins for every student, parent and teacher — you don't touch a config file." },
                  { q: "Can we import our existing student data?", a: "Yes. Send us your current roster as a spreadsheet and we'll map classes, guardians and IDs into Smart & Thrive as part of onboarding — no manual re-entry required." },
                  { q: "Does every plan include all six modules?", a: "Admissions, finance, attendance, report cards and the parent portal are included on every plan. CBT is included from the Growth plan up. There are no locked modules or surprise add-on fees." },
                  { q: "We're already mid-term — can we still switch?", a: "Absolutely. Most schools switch mid-term. We import your current fee ledgers and attendance records so nothing is lost in the transition, and your team keeps working while we set things up in the background." },
                  { q: "How does billing work?", a: "Pricing is quoted against your student cap, not per feature. Tell us roughly how many students you have and we'll send a straightforward price sheet — no hidden per-module charges." },
                  { q: "Is our data secure?", a: "Every record is encrypted in transit and at rest, access is role-based, and daily backups run automatically. See the Security section above for the full detail." },
                  { q: "Do parents need to install an app?", a: "No. The parent portal works in any mobile browser — no app store, no download. Parents log in and see fees, attendance and reports immediately." },
                  { q: "Can we run multiple campuses under one account?", a: "Yes — that's exactly what the Enterprise plan is built for, with consolidated reporting across campuses and a dedicated success manager to help you set it up." },
                ].map((item, i) => (
                  <div key={i} className="faq-item">
                    <button className="faq-q" aria-expanded="false"><span>{item.q}</span><span className="faq-icon"></span></button>
                    <div className="faq-a"><p>{item.a}</p></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ============ FINAL CTA ============ */}
        <section className="final-cta">
          <div className="ph"><img src="https://images.unsplash.com/photo-1758270703878-de80505b6714?auto=format&fit=crop&w=1600&q=75" alt="Students engaged and raising hands in a lively lecture hall." /></div>
          <div className="container">
            <div className="final-inner reveal">
              <span className="eyebrow on-dark">Let&apos;s talk</span>
              <h2>Ready to see what a calm term feels like?</h2>
              <p>Book a 30-minute demo. We&apos;ll walk your team through the modules and answer every question — no slides, just the product.</p>
              <div className="final-ctas">
                <a className="btn btn-gold" href={mailto("Book a demo - Smart & Thrive O/S")}>Book a demo<ArrowRight /></a>
                <a className="btn btn-ghost-dark" href={LIVE_URL}>See it live</a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="container">
          <div className="footer-top">
            <div className="footer-brand">
              <span className="brand-name" style={{ fontSize: "1.1rem" }}>Smart &amp; Thrive <em>O/S</em></span>
              <p>The connected operating system for schools that would rather run a term than referee seven different tools.</p>
            </div>
            <div className="footer-col">
              <h4>Product</h4>
              <ul>
                <li><a href="#modules">Modules</a></li>
                <li><a href="#how">How it works</a></li>
                <li><a href="#security">Security</a></li>
                <li><a href="#pricing">Pricing</a></li>
                <li><a href={LIVE_URL}>See it live</a></li>
              </ul>
            </div>
            <div className="footer-col">
              <h4>Company</h4>
              <ul>
                <li><a href={`mailto:${CONTACT_EMAIL}`}>Contact us</a></li>
                <li><a href={mailto("Book a demo - Smart & Thrive O/S")}>Book a demo</a></li>
                <li><a href="#faq">FAQ</a></li>
              </ul>
            </div>
            <div className="footer-col">
              <h4>Get in touch</h4>
              <ul>
                <li><a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></li>
              </ul>
            </div>
          </div>
          <div className="footer-bottom">
            <span>© {new Date().getFullYear()} Smart &amp; Thrive O/S. All rights reserved.</span>
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          </div>
        </div>
      </footer>

      <LandingInteractions />
    </div>
  );
}
