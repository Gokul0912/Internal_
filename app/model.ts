export const modules = {
  bug: { label: "Bug Tracker", single: "bug", prefix: "BUG", rank: "Severity",
    states: ["Open", "Acknowledged", "In Progress", "Fixed", "Verified", "Closed"],
    fields: { Module: [], "Steps to reproduce": [], "Expected result": [], "Actual result": [] } },
  feature: { label: "Feature Requests", single: "feature request", prefix: "REQ", rank: "Priority",
    states: ["Proposed", "Under Review", "Approved", "Rejected", "Planned", "In Development", "Completed", "Released"],
    fields: { "Problem being solved": [], "Proposed solution": [], Complexity: ["Easy", "Moderate", "Complex"] } },
  feedback: { label: "User Feedback", single: "feedback", prefix: "FBK", rank: "Impact",
    states: ["New", "Reviewing", "Action Required", "Resolved", "Closed"],
    fields: { "User name": [], "User type": ["Customer", "Internal User", "Tester"],
      Category: ["UI/UX", "Performance", "Functionality", "Bug", "Feature Request", "General"], "Suggested improvement": [] } },
} as const;

export type Kind = keyof typeof modules;
export type Member = { id: string; name: string; role: string; is_tester: boolean };
export type Application = { id: string; name: string; description: string; archived: boolean };
export type Report = {
  id: string; number: number; app_id: string; kind: Kind; title: string; description: string;
  status: string; rank: string; details: Record<string, string>; author: string;
  assignee: string | null; source_id: string | null; created_at: string;
};
export type Summary = Pick<Report, "kind" | "status" | "rank"> & { category: string | null; total: number };
export const reportCode = (report: Report) => modules[report.kind].prefix + "-" + String(report.number).padStart(4, "0");
export const roles = ["Admin", "Developer", "Team Member", "Viewer"];
export const ranks = (kind: Kind) => kind === "bug" ? ["Critical", "High", "Medium", "Low"] : ["High", "Medium", "Low"];

export function csvCell(value: string) {
  const safe = /^[\s\u0000-\u001f]*[=+@-]|^[\t\r\n]/u.test(value) ? "'" + value : value;
  return '"' + safe.replaceAll('"', '""') + '"';
}
