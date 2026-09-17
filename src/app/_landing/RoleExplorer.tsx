import {
  ArrowRight,
  BookOpenCheck,
  BriefcaseBusiness,
  GraduationCap,
  ShieldCheck,
  UsersRound,
} from "lucide-react";

const roles = [
  {
    name: "Administrator",
    icon: ShieldCheck,
    summary: "Keep the whole school aligned from one role-aware workspace.",
    capabilities: [
      "Finance, reports, analytics, and reconciliation",
      "Students, staff, roles, and school setup",
      "Website, communication, and operational oversight",
    ],
  },
  {
    name: "Backoffice",
    icon: BriefcaseBusiness,
    summary: "Run the daily financial and operational workflows behind the school.",
    capabilities: [
      "Income, expenses, receipts, and student balances",
      "Inventory, procurement, payroll, and vendors",
      "Enquiries, announcements, and printable reports",
    ],
  },
  {
    name: "Teacher / Faculty",
    icon: BookOpenCheck,
    summary: "Move from the day's timetable to teaching actions without losing context.",
    capabilities: [
      "Assigned classes and daily teaching schedule",
      "Attendance, assessments, and grade entry",
      "CBT exams and learning-management courses",
    ],
  },
  {
    name: "Student",
    icon: GraduationCap,
    summary: "Give each learner a focused view of their own academic journey.",
    capabilities: [
      "Assigned exams and secure test access",
      "Results, report cards, and timetable",
      "Courses, lessons, and school announcements",
    ],
  },
  {
    name: "Parent",
    icon: UsersRound,
    summary: "Help families follow every linked child from one private portal.",
    capabilities: [
      "Attendance and recent payment history",
      "Published report cards and academic progress",
      "Child switching and school announcements",
    ],
  },
] as const;

export default function RoleExplorer() {
  return (
    <section className="section role-explorer" id="roles">
      <div className="container">
        <div className="role-explorer-head reveal">
          <span className="eyebrow" style={{ justifyContent: "center" }}>Explore by role</span>
          <h2>One school, five focused workspaces.</h2>
          <p>
            Every person sees the tools that fit their responsibilities, while the school keeps one connected record.
          </p>
        </div>

        <div className="role-grid">
          {roles.map(({ name, icon: Icon, summary, capabilities }, index) => (
            <article key={name} className={`role-card reveal reveal-${Math.min(index + 1, 5)}`}>
              <div className="role-icon" aria-hidden="true"><Icon /></div>
              <h3>{name}</h3>
              <p>{summary}</p>
              <ul>
                {capabilities.map(capability => (
                  <li key={capability}><span aria-hidden="true"></span>{capability}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>

        <div className="role-demo reveal">
          <div>
            <h3>Want to explore a specific workspace?</h3>
            <p>Role-based demo access is arranged on request. No shared credentials are published on this site.</p>
          </div>
          <a className="btn btn-primary" href="/contact?subject=Request%20demo%20access">
            Request demo access <ArrowRight />
          </a>
        </div>
      </div>
    </section>
  );
}
