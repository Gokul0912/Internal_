"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Activity, ArrowDownToLine, ArrowRight, Bug, Boxes, ChevronLeft, ChevronRight, LayoutDashboard, LogOut, MessageSquare, Plus, Search, Settings, Sparkles, Users, X } from "lucide-react";
import { createClient } from "./supabase-client";
import { csvCell, modules, ranks, reportCode, roles, type Application, type Kind, type Member, type Report, type Summary } from "./model";
import styles from "./hub.module.css";

const PAGE_SIZE = 15;
const attachmentExtensions: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "video/mp4": "mp4", "video/webm": "webm",
};
const attachmentAccept = Object.keys(attachmentExtensions).join(",");
function attachmentExtension(file: File) {
  const extension = attachmentExtensions[file.type];
  if (!extension || file.size === 0 || file.size > 10_485_760) throw new Error("Choose a supported image or video up to 10 MB.");
  return extension;
}
async function uploadAttachment(db: ReturnType<typeof createClient>, reportId: string, file: File) {
  const path = reportId + "/" + crypto.randomUUID() + "." + attachmentExtension(file);
  checked(await db.storage.from("hub-attachments").upload(path, file));
}
const nav = [
  ["dashboard", "Overview", LayoutDashboard], ["bug", "Bug Tracker", Bug],
  ["feature", "Feature Requests", Sparkles], ["feedback", "User Feedback", MessageSquare],
  ["applications", "Applications", Boxes], ["team", "Team Members", Users], ["settings", "Settings", Settings],
] as const;
type Recurring = { title: string; category: string; total: number };
type View = typeof nav[number][0];
type Filters = { app: string; from: string; to: string; query: string; rank: string; status: string; assignee: string };
const emptyFilters: Filters = { app: "", from: "", to: "", query: "", rank: "", status: "", assignee: "" };
const formatDate = (date: string) => new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const initialStatus = (kind: Kind) => modules[kind].states[0];

function checked<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

function untilDate(date: string) {
  return date ? new Date(Date.parse(date) + 86_400_000).toISOString() : null;
}

function Select({ label, options, ...props }: {
  label: string; options: readonly (string | { id: string; name: string })[];
} & React.ComponentProps<"select">) {
  return <label>{label}<select {...props}>{options.map(option => {
    const value = typeof option === "string" ? option : option.id;
    return <option key={value} value={value}>{typeof option === "string" ? option || "All" : option.name}</option>;
  })}</select></label>;
}

function Badge({ value }: { value: string }) {
  const color = ["Critical", "Rejected"].includes(value) ? "red"
    : ["High", "Action Required"].includes(value) ? "orange"
    : ["In Progress", "In Development", "Under Review", "Reviewing", "Open", "New"].includes(value) ? "blue"
    : ["Resolved", "Fixed", "Verified", "Approved", "Completed", "Released"].includes(value) ? "green" : "grey";
  return <span className={styles.badge} data-color={color}>{value}</span>;
}

export default function Hub() {
  const [db] = useState(createClient);
  const [account, setAccount] = useState<{ id: string; email?: string } | null>(null);
  const [member, setMember] = useState<Member | null>(null);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>("dashboard");
  const [filters, setFilters] = useState(emptyFilters);
  const [page, setPage] = useState(0);
  const [reports, setReports] = useState<Report[]>([]);
  const [summary, setSummary] = useState<Summary[]>([]);
  const [recurring, setRecurring] = useState<Recurring[]>([]);
  const [apps, setApps] = useState<Application[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [access, setAccess] = useState<{ app_id: string; member_id: string }[]>([]);
  const [count, setCount] = useState(0);
  const [version, refresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [selected, setSelected] = useState<Report | null>(null);
  const [editor, setEditor] = useState<{ kind: Kind; report?: Report } | null>(null);
  const [confirm, setConfirm] = useState<Report | null>(null);
  const admin = member?.role === "Admin";
  const submitter = admin || member?.role === "Team Member";
  const kind = view === "bug" || view === "feature" || view === "feedback" ? view : null;

  const loadAccount = useCallback(async () => {
    const { data } = await db.auth.getUser();
    const membership = data.user ? checked(await db.from("hub_members").select("id,name,role,is_tester").eq("id", data.user.id).maybeSingle<Member>()) : null;
    return { user: data.user, membership };
  }, [db]);

  useEffect(() => {
    let active = true;
    loadAccount().then(({ user, membership }) => { if (active) { setAccount(user); setMember(membership); } }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, [loadAccount]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!member) return;
    let active = true;
    Promise.all([
      db.from("hub_apps").select("*").order("name"),
      db.from("hub_members").select("id,name,role,is_tester").order("name"),
      db.from("hub_access").select("app_id,member_id"),
    ]).then(([applications, people, assignments]) => {
      if (!active) return;
      setApps(checked(applications) ?? []);
      setMembers(checked(people) ?? []);
      setAccess(checked(assignments) ?? []);
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [db, member, version]);

  const reportQuery = useCallback((offset: number, limit: number) => {
    let query = db.from("hub_reports").select("*", { count: "exact" }).order("created_at", { ascending: false }).order("id");
    if (kind) query = query.eq("kind", kind);
    if (filters.app) query = query.eq("app_id", filters.app);
    if (filters.from) query = query.gte("created_at", filters.from + "T00:00:00Z");
    if (filters.to) query = query.lt("created_at", untilDate(filters.to)!);
    if (filters.rank) query = query.eq("rank", filters.rank);
    if (filters.status) query = query.eq("status", filters.status);
    if (filters.assignee) query = query.eq("assignee", filters.assignee);
    if (filters.query.trim()) query = query.ilike("title", "%" + filters.query.trim().replace(/[\\%_]/g, "\\$&") + "%");
    return query.range(offset, offset + limit - 1);
  }, [db, filters, kind]);

  useEffect(() => {
    if (!member || (!kind && view !== "dashboard")) return;
    let active = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const dateScope = { application: filters.app || null, since: filters.from ? filters.from + "T00:00:00Z" : null, until_date: untilDate(filters.to) };
        const [list, aggregates, repeats] = await Promise.all([
          reportQuery(page * PAGE_SIZE, view === "dashboard" ? 6 : PAGE_SIZE),
          view === "dashboard" ? db.rpc("hub_summary", dateScope) : null,
          kind === "feedback" ? db.rpc("hub_recurring_feedback", dateScope) : null,
        ]);
        if (!active) return;
        setReports(checked(list) ?? []);
        setCount(list.count ?? 0);
        if (aggregates) setSummary(checked(aggregates) ?? []);
        setRecurring(repeats ? checked(repeats) ?? [] : []);
      } catch (e) {
        if (active) { setReports([]); setSummary([]); setCount(0); setError((e as Error).message); }
      } finally {
        if (active) setLoading(false);
      }
    }, 180);
    return () => { active = false; clearTimeout(timer); };
  }, [db, filters, kind, member, page, reportQuery, version, view]);

  async function act(work: () => Promise<void>, message?: string) {
    setBusy(true);
    setError("");
    try {
      await work();
      if (message) setToast(message);
      refresh(value => value + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function navigate(next: View) {
    setView(next); setPage(0); setFilters(emptyFilters); setReports([]); setSummary([]); setLoading(true); setError("");
  }

  function filter(key: keyof Filters, value: string) {
    setFilters(previous => ({ ...previous, [key]: value })); setPage(0); setLoading(true);
  }

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await act(async () => {
      const { error: signInError } = await db.auth.signInWithPassword({ email: String(data.get("email")), password: String(data.get("password")) });
      if (signInError) throw signInError;
      const { user, membership } = await loadAccount();
      setAccount(user); setMember(membership);
    });
  }

  async function signOut() {
    await act(async () => {
      const { error: signOutError } = await db.auth.signOut();
      if (signOutError) throw signOutError;
      setAccount(null); setMember(null); setReports([]); setSummary([]); setApps([]); setMembers([]); setAccess([]);
      setSelected(null); setEditor(null); setConfirm(null); navigate("dashboard");
    });
  }

  async function saveReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;
    const form = new FormData(event.currentTarget);
    const { kind: reportKind, report } = editor;
    const file = form.get("attachment");
    const upload = file instanceof File && file.size > 0 ? file : null;
    await act(async () => {
      if (upload) attachmentExtension(upload);
      const details = Object.fromEntries(Object.keys(modules[reportKind].fields).map(key => [key, String(form.get(key) ?? "").trim()]));
      const payload = {
        app_id: String(form.get("app_id")), title: String(form.get("title")).trim(),
        description: String(form.get("description")).trim(), rank: String(form.get("rank")),
        details,
      };
      const saved = checked(await (report
        ? db.from("hub_reports").update(payload).eq("id", report.id)
        : db.from("hub_reports").insert({ ...payload, kind: reportKind, status: initialStatus(reportKind) })).select("*").single()) as Report;
      setEditor(null);
      setSelected(saved);
      if (upload) {
        try {
          await uploadAttachment(db, saved.id, upload);
        } catch (e) {
          refresh(value => value + 1);
          throw new Error("Report saved. Attachment upload failed: " + (e as Error).message);
        }
      }
    }, report ? "Report updated" : "Report submitted");
  }

  async function exportReports() {
    if (!kind || !admin) return;
    await act(async () => {
      const fields = Object.keys(modules[kind].fields);
      const rows = [["ID", "Date", "Application", "Title", "Description", modules[kind].rank, "Status", "Reporter", "Assignee", ...fields]];
      const batchSize = 500;
      for (let offset = 0; ; offset += batchSize) {
        const batch = (checked(await reportQuery(offset, batchSize)) ?? []) as Report[];
        rows.push(...batch.map(r => [reportCode(r), r.created_at, appName(r.app_id), r.title, r.description,
          r.rank, r.status, person(r.author), person(r.assignee), ...fields.map(field => r.details[field] ?? "")]));
        if (batch.length < batchSize) break;
      }
      const blob = new Blob(["\ufeff", rows.map(row => row.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = "product-hub-" + kind + ".csv"; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "CSV exported");
  }

  const appName = (id: string) => apps.find(app => app.id === id)?.name ?? "Application";
  const person = (id: string | null) => members.find(user => user.id === id)?.name ?? "Unassigned";
  const assignedMembers = (id: string) => members.filter(user => user.role === "Admin" || access.some(entry => entry.app_id === id && entry.member_id === user.id));

  if (!ready || !member) return <main className={styles.root + " " + styles.authPage}><div className={styles.auth}><Brand />
    {!ready ? <p role="status">Loading workspace…</p> : account ? <>
      <h1>Workspace access required</h1><p>Ask a Product Hub admin to add your account.</p><button onClick={signOut}>Sign out</button>
    </> : <form onSubmit={login}><h1>Sign in to your workspace</h1><p>Use your company account to access Product Hub.</p>
      <label>Email<input name="email" type="email" autoComplete="username" required /></label>
      <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
      <button className={styles.primary} disabled={busy}>Sign in <ArrowRight size={16} /></button>
    </form>}
    {error && <p className={styles.error} role="alert">{error}</p>}
  </div></main>;

  return <div className={styles.root}>
    <aside className={styles.sidebar}><Brand /><span className={styles.eyebrow}>WORKSPACE</span>
      <nav aria-label="Product Hub">{nav.filter(([key]) => admin || (key !== "applications" && key !== "team")).map(([key, label, Icon]) =>
        <button key={key} type="button" aria-current={view === key ? "page" : undefined} onClick={() => navigate(key)}><Icon size={17} />{label}</button>)}</nav>
      <div className={styles.identity}><span>{member.name.slice(0, 2).toUpperCase()}</span><div><strong>{member.name}</strong><small>{member.role}</small></div>
        <button onClick={signOut} aria-label="Sign out" title="Sign out"><LogOut size={16} /></button></div>
    </aside>
    <main className={styles.main}>
      <div className={styles.top}><span>Workspace <ChevronRight size={13} /> {nav.find(item => item[0] === view)?.[1]}</span><span className={styles.internal}><i /> Internal workspace</span></div>
      <header className={styles.header}><div><div className={styles.eyebrow}>PRODUCT OPERATIONS</div>
        <h1>{view === "dashboard" ? "Product overview" : nav.find(item => item[0] === view)?.[1]}</h1>
        <p>{view === "dashboard" ? "Track product health, incoming reports, and the work moving forward." : kind ? "Review submissions and follow their progress across applications." : "Manage your Product Hub workspace."}</p>
      </div><div className={styles.actions}>
        {kind && admin && <button onClick={exportReports} disabled={busy}><ArrowDownToLine size={16} /> Export CSV</button>}
        {(kind || view === "dashboard") && submitter && <button className={styles.primary} onClick={() => setEditor({ kind: kind ?? "bug" })}><Plus size={17} /> {kind ? "New " + modules[kind].single : "New report"}</button>}
      </div></header>
      {error && <div className={styles.error} role="alert">{error}<button onClick={() => setError("")} aria-label="Dismiss error"><X size={15} /></button></div>}
      {(kind || view === "dashboard") && <>
        <section className={styles.filters} aria-label="Report filters">
          {kind && <label className={styles.search}>Search titles<span><Search size={16} /><input placeholder="Search reports…" value={filters.query} onChange={e => filter("query", e.target.value)} /></span></label>}
          <Select label="Application" options={[{ id: "", name: "All applications" }, ...apps]} value={filters.app} onChange={e => filter("app", e.target.value)} />
          <label>From (UTC)<input type="date" value={filters.from} max={filters.to || undefined} onChange={e => filter("from", e.target.value)} /></label>
          <label>Through (UTC)<input type="date" value={filters.to} min={filters.from || undefined} onChange={e => filter("to", e.target.value)} /></label>
          {kind && <>
            <Select label={modules[kind].rank} options={["", ...ranks(kind)]} value={filters.rank} onChange={e => filter("rank", e.target.value)} />
            <Select label="Status" options={["", ...modules[kind].states]} value={filters.status} onChange={e => filter("status", e.target.value)} />
            <Select label="Assignee" options={["", ...members]} value={filters.assignee} onChange={e => filter("assignee", e.target.value)} />
          </>}
        </section>
        {view === "dashboard" && <Dashboard summary={summary} loading={loading} />}
        {kind === "feedback" && !loading && recurring.length > 0 && <section className={styles.card + " " + styles.recurring}>
          <div className={styles.cardHead}><div><h2>Recurring feedback</h2><p>Repeated titles within the same category and date range</p></div><MessageSquare size={17} /></div>
          <ul>{recurring.map(item => <li key={item.category + ":" + item.title}>{item.title} <Badge value={item.category} /> <strong>{item.total} reports</strong></li>)}</ul>
        </section>}
        <section className={styles.card}><div className={styles.cardHead}><div><h2>{kind ? "Report queue" : "Recently submitted"}</h2><p>{kind ? count + " matching reports" : "Latest activity across your applications"}</p></div><Activity size={19} /></div>
          {loading ? <p className={styles.empty} role="status">Loading reports…</p> : !reports.length ? <p className={styles.empty}>No reports match your filters.</p> :
            <div className={styles.scroll}><table><thead><tr><th>Report</th><th>Application</th><th>{kind ? modules[kind].rank : "Level"}</th><th>Status</th><th>Assignee</th><th>Submitted</th></tr></thead>
              <tbody>{reports.map(report => <tr key={report.id} data-critical={report.rank === "Critical"}>
                <td><button className={styles.reportLink} onClick={() => { setError(""); setSelected(report); }}><small>{reportCode(report)}</small><strong>{report.title}</strong></button></td>
                <td>{appName(report.app_id)}</td><td><Badge value={report.rank} /></td><td><Badge value={report.status} /></td><td>{person(report.assignee)}</td><td>{formatDate(report.created_at)}</td>
              </tr>)}</tbody></table></div>}
          {kind && <div className={styles.pagination}><span>Page {page + 1} of {Math.max(1, Math.ceil(count / PAGE_SIZE))}</span>
            <button aria-label="Previous page" disabled={loading || page === 0} onClick={() => { setLoading(true); setPage(page - 1); }}><ChevronLeft size={16} /></button>
            <button aria-label="Next page" disabled={loading || (page + 1) * PAGE_SIZE >= count} onClick={() => { setLoading(true); setPage(page + 1); }}><ChevronRight size={16} /></button></div>}
        </section>
      </>}
      {admin && view === "applications" && <section className={styles.management}>
        <ApplicationForm busy={busy} save={payload => act(async () => { checked(await db.from("hub_apps").insert(payload)); }, "Application added")} />
        {apps.map(app => <article className={styles.card} key={app.id}><ApplicationForm key={app.id + app.name + app.description + app.archived} app={app} busy={busy}
          save={payload => act(async () => { checked(await db.from("hub_apps").update(payload).eq("id", app.id)); }, "Application saved")} />
          <form className={styles.adminForm} onSubmit={event => {
            event.preventDefault();
            const memberId = String(new FormData(event.currentTarget).get("member"));
            void act(async () => { checked(await db.from("hub_access").insert({ app_id: app.id, member_id: memberId })); }, "Member assigned");
          }}><Select label="Assign member" name="member" required options={[{ id: "", name: "Choose a team member" }, ...members.filter(user => !assignedMembers(app.id).some(assigned => assigned.id === user.id))]} />
            <button disabled={busy}>Add member</button>
            <div className={styles.actions}>{access.filter(entry => entry.app_id === app.id).map(entry =>
              <button type="button" disabled={busy} key={entry.member_id} onClick={() => act(async () => { checked(await db.from("hub_access").delete().eq("app_id", app.id).eq("member_id", entry.member_id)); }, "Access removed")}>{person(entry.member_id)} <X size={13} aria-label="Remove access" /></button>)}</div>
          </form></article>)}
      </section>}
      {admin && view === "team" && <section className={styles.management}>
        <MemberForm busy={busy} save={payload => act(async () => { checked(await db.from("hub_members").insert(payload)); }, "Member added")} />
        {members.map(user => <MemberForm key={user.id + user.name + user.role} user={user} busy={busy} self={user.id === member.id}
          save={payload => act(async () => { checked(await db.from("hub_members").update(payload).eq("id", user.id)); if (user.id === member.id) setMember((await loadAccount()).membership); }, "Member updated")} />)}
      </section>}
      {view === "settings" && <section className={styles.card}><div className={styles.cardHead}><div><h2>Your account</h2><p>{account?.email}</p></div><Badge value={member.role} /></div><div className={styles.adminForm}><button onClick={signOut}><LogOut size={16} /> Sign out</button></div></section>}
    </main>
    {selected && !editor && !confirm && <ReportDetail key={selected.id} report={selected} db={db} member={member} members={assignedMembers(selected.app_id).filter(user => user.role === "Admin" || user.role === "Developer" || (selected.kind === "feedback" && user.role === "Team Member") || user.id === selected.assignee)}
      person={person} appName={appName(selected.app_id)} busy={busy} version={version} actionError={error} close={() => setSelected(null)}
      update={setSelected} act={act} edit={() => setEditor({ kind: selected.kind, report: selected })} remove={() => setConfirm(selected)} />}
    {editor && <Modal title={editor.report ? "Edit " + modules[editor.kind].single : "New report"} close={() => setEditor(null)} busy={busy}>
      <form className={styles.form} onSubmit={saveReport} key={editor.kind}>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        {!editor.report && <Select label="Report type" options={Object.entries(modules).map(([id, value]) => ({ id, name: value.label }))} value={editor.kind} onChange={e => setEditor({ kind: e.target.value as Kind })} />}
        <Select label="Application" name="app_id" required defaultValue={editor.report?.app_id ?? (apps.some(app => app.id === filters.app && !app.archived) ? filters.app : "")} options={[{ id: "", name: "Choose an application" }, ...apps.filter(app => !app.archived || app.id === editor.report?.app_id)]} />
        <label>Title<input name="title" required maxLength={180} defaultValue={editor.report?.title} /></label>
        <label>Description<textarea name="description" required maxLength={12000} rows={4} defaultValue={editor.report?.description} /></label>
        <Select label={modules[editor.kind].rank} name="rank" options={ranks(editor.kind)} defaultValue={editor.report?.rank ?? "Medium"} />
        {Object.entries(modules[editor.kind].fields).map(([name, options]) => options.length
          ? <Select key={name} label={name} name={name} options={options} defaultValue={editor.report?.details[name]} />
          : <label key={name}>{name}<textarea name={name} rows={2} maxLength={3000} defaultValue={editor.report?.details[name]} /></label>)}
        {editor.kind === "bug" && <label>Screenshot or video (10 MB max)<input type="file" name="attachment" accept={attachmentAccept} /></label>}
        {!editor.report && !apps.some(app => !app.archived) && <p>No active applications are available. Ask a workspace admin for access.</p>}
        <div className={styles.actions}><button type="button" disabled={busy} onClick={() => setEditor(null)}>Cancel</button><button className={styles.primary} disabled={busy || (!editor.report && !apps.some(app => !app.archived))}>{busy ? "Saving…" : "Save report"}</button></div>
      </form>
    </Modal>}
    {confirm && <Modal title="Delete report?" busy={busy} close={() => setConfirm(null)}><div className={styles.form}>
      {error && <p role="alert" className={styles.error}>{error}</p>}<p>{confirm.title} and its activity will be permanently deleted.</p>
      <div className={styles.actions}><button disabled={busy} onClick={() => setConfirm(null)}>Cancel</button>
        <button className={styles.danger} disabled={busy} onClick={() => act(async () => {
          if (confirm.kind === "bug") {
            const bucket = db.storage.from("hub-attachments");
            for (;;) {
              const files = checked(await bucket.list(confirm.id, { limit: 100 })) ?? [];
              if (!files.length) break;
              checked(await bucket.remove(files.map(file => confirm.id + "/" + file.name)));
            }
          }
          checked(await db.from("hub_reports").delete().eq("id", confirm.id).select("id").single());
          setConfirm(null); setSelected(null); setPage(0);
        }, "Report deleted")}>Delete report</button></div>
    </div></Modal>}
    {toast && <div className={styles.toast} role="status">{toast}</div>}
  </div>;
}

function Brand() {
  return <div className={styles.brand}><span><Boxes size={22} /></span><div>Product Hub<small>DEVELOPMENT WORKSPACE</small></div></div>;
}

function Modal({ title, close, busy, children }: { title: string; close: () => void; busy: boolean; children: ReactNode }) {
  return <dialog className={styles.modal} aria-label={title} ref={dialog => { if (dialog && !dialog.open) dialog.showModal(); }}
    onCancel={event => { event.preventDefault(); if (!busy) close(); }}>
    <div className={styles.cardHead}><h2>{title}</h2><button type="button" aria-label="Close dialog" disabled={busy} onClick={close}><X size={18} /></button></div>{children}
  </dialog>;
}

function Dashboard({ summary, loading }: { summary: Summary[]; loading: boolean }) {
  const total = (kind: Kind, states?: string[]) => summary.reduce((sum, item) => sum + (item.kind === kind && (!states || states.includes(item.status)) ? Number(item.total) : 0), 0);
  const metrics = [
    ["Reported bugs", total("bug")], ["Open bugs", total("bug", ["Open", "Acknowledged"])],
    ["Being fixed", total("bug", ["In Progress"])], ["Resolved bugs", total("bug", ["Fixed", "Verified", "Closed"])],
    ["Feature requests", total("feature")], ["Approved features", total("feature", ["Approved", "Planned", "In Development", "Completed", "Released"])],
    ["Pending feedback", total("feedback", ["New", "Reviewing", "Action Required"])],
  ] as const;
  const charts = [
    ["Bugs by severity", "bug", "rank", ranks("bug")], ["Bugs by status", "bug", "status", modules.bug.states],
    ["Features by priority", "feature", "rank", ranks("feature")], ["Feedback by category", "feedback", "category", modules.feedback.fields.Category],
  ] as const;
  return <><section className={styles.metrics} aria-label="Summary metrics">
    {metrics.map(([label, value], index) => <article className={styles.metric} key={label}><span className={styles.metricIcon}>{index < 4 ? <Bug size={16} /> : index < 6 ? <Sparkles size={16} /> : <MessageSquare size={16} />}</span><strong>{loading ? "…" : value}</strong><span>{label}</span></article>)}
  </section><section className={styles.charts} aria-label="Report distributions">
    {charts.map(([label, kind, dimension, labels]) => {
      const bins = labels.map(name => ({ name, value: summary.reduce((sum, item) => sum + (item.kind === kind && item[dimension] === name ? Number(item.total) : 0), 0) }));
      const max = Math.max(1, ...bins.map(bin => bin.value));
      return <article className={styles.card} key={label}><div className={styles.cardHead}><h2>{label}</h2><Activity size={16} /></div>
        <div className={styles.bars}>{bins.map((bin, index) => <div key={bin.name}><span>{bin.name}</span><div aria-hidden="true"><i style={{ width: (loading ? 0 : bin.value / max * 100) + "%", opacity: 1 - index * 0.1 }} /></div><strong>{loading ? "…" : bin.value}</strong></div>)}</div>
      </article>;
    })}
  </section></>;
}

function ApplicationForm({ app, save, busy }: { app?: Application; save: (value: Omit<Application, "id">) => void; busy: boolean }) {
  return <form className={styles.adminForm} onSubmit={e => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    save({ name: String(data.get("name")).trim(), description: String(data.get("description")).trim(), archived: data.has("archived") });
  }}>
    <h2>{app?.name ?? "Add an application"}</h2>
    <label>Name<input name="name" defaultValue={app?.name} required maxLength={120} /></label>
    <label>Description<textarea name="description" defaultValue={app?.description} maxLength={2000} rows={2} /></label>
    {app && <label className={styles.inline}><input name="archived" type="checkbox" defaultChecked={app.archived} /> Archived</label>}
    <button className={styles.primary} disabled={busy}>{app ? "Save application" : "Add application"}</button>
  </form>;
}

function MemberForm({ user, save, busy, self }: { user?: Member; save: (value: Member) => void; busy: boolean; self?: boolean }) {
  return <form className={styles.adminForm} onSubmit={e => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    save({ id: user?.id ?? String(data.get("id")).trim(), name: String(data.get("name")).trim(), role: self ? user!.role : String(data.get("role")), is_tester: data.has("is_tester") });
  }}>
    <h2>{user?.name ?? "Add an existing account"}</h2>
    {!user && <label>Supabase Auth user ID<input name="id" required pattern="[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}" /></label>}
    <label>Display name<input name="name" required maxLength={120} defaultValue={user?.name} /></label>
    <Select name="role" label="Role" options={roles} defaultValue={user?.role ?? "Team Member"} disabled={self} />
    <label className={styles.inline}><input type="checkbox" name="is_tester" defaultChecked={user?.is_tester} /> Can verify fixes</label>
    <button className={styles.primary} disabled={busy}>{user ? "Save member" : "Add member"}</button>
  </form>;
}

type Comment = { id: string; author: string; body: string; resolution: boolean; created_at: string };
type History = { id: number; actor: string | null; previous: string | null; status: string; created_at: string };
type Vote = { member_id: string };
function ReportDetail({ report, db, member, members, person, appName, busy, version, actionError, close, update, act, edit, remove }: {
  report: Report; db: ReturnType<typeof createClient>; member: Member; members: Member[];
  person: (id: string | null) => string; appName: string; busy: boolean; version: number; actionError: string;
  close: () => void; update: (report: Report) => void;
  act: (work: () => Promise<void>, message?: string) => Promise<void>; edit: () => void; remove: () => void;
}) {
  const [activity, setActivity] = useState<{ comments: Comment[]; history: History[]; voted: boolean; votes: number; files: string[]; related: Report[] } | null>(null);
  const [error, setError] = useState("");
  const [comment, setComment] = useState("");
  const [resolution, setResolution] = useState(false);
  const admin = member.role === "Admin";
  const technical = admin || member.role === "Developer";
  const mod = modules[report.kind];
  const id = report.id;
  const feature = report.kind === "feature";
  const canComment = technical || (feature && member.role === "Team Member");
  const developerTransitions: Record<string, string[]> = {
    Acknowledged: ["In Progress"], "In Progress": ["Fixed"], Approved: ["In Development"], Planned: ["In Development"], "In Development": ["Completed"],
  };
  const canVerify = member.role === "Team Member" && member.is_tester && report.kind === "bug" && report.status === "Fixed" && report.assignee !== member.id;
  const statusOptions = admin ? mod.states : [report.status, ...(canVerify ? ["Verified"] : technical && report.kind !== "feedback" ? developerTransitions[report.status] ?? [] : [])];

  useEffect(() => {
    let active = true;
    Promise.all([
      db.from("hub_comments").select("*").eq("report_id", id).order("created_at").limit(100),
      db.from("hub_history").select("*").eq("report_id", id).order("created_at", { ascending: false }).limit(100),
      feature ? db.from("hub_votes").select("member_id", { head: true, count: "exact" }).eq("report_id", id) : null,
      feature ? db.from("hub_votes").select("member_id").eq("report_id", id).eq("member_id", member.id).maybeSingle<Vote>() : null,
      report.kind === "bug" ? db.storage.from("hub-attachments").list(id, { limit: 100 }) : null,
      report.kind === "feedback" ? db.from("hub_reports").select("*").eq("source_id", id) : null,
    ]).then(([comments, history, votes, voted, files, related]) => {
      if (!active) return;
      if (votes?.error) throw new Error(votes.error.message);
      setActivity({ comments: checked(comments) ?? [], history: checked(history) ?? [],
        voted: Boolean(voted && checked(voted)), votes: votes?.count ?? 0,
        files: files ? (checked(files) ?? []).map(file => file.name) : [], related: related ? checked(related) ?? [] : [] });
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [db, feature, id, member.id, report.kind, version]);

  function patch(payload: Partial<Report>, message: string) {
    return act(async () => {
      const saved = checked(await db.from("hub_reports").update(payload).eq("id", id).select("*").single());
      update(saved);
    }, message);
  }

  return <Modal title={reportCode(report)} close={close} busy={busy}><div className={styles.form}>
    <div className={styles.actions}><Badge value={report.status} /><Badge value={report.rank} /></div>
    <div><h2>{report.title}</h2><p>{appName} · {person(report.author)} · {formatDate(report.created_at)}</p></div>
    <p className={styles.preserve}>{report.description}</p>
    {Object.entries(report.details).filter(([, value]) => value).map(([key, value]) => <div key={key}><strong>{key}</strong><p className={styles.preserve}>{value}</p></div>)}
    {report.source_id && <p>Created from feedback</p>}
    <div className={styles.actions}>
      {statusOptions.length > 1 && <Select label="Status" options={statusOptions} disabled={busy} value={report.status} onChange={e => patch({ status: e.target.value }, "Status updated")} />}
      {admin ? <Select label="Assignee" options={[{ id: "", name: "Unassigned" }, ...members]} disabled={busy} value={report.assignee ?? ""} onChange={e => patch({ assignee: e.target.value || null }, "Assignment updated")} /> : <p>Assignee · {person(report.assignee)}</p>}
    </div>
    {admin && <div className={styles.actions}><button disabled={busy} onClick={edit}>Edit report</button><button disabled={busy} onClick={remove}>Delete report</button>
      {report.kind === "feedback" && (["bug", "feature"] as const).map(kind => <button key={kind} disabled={busy || activity?.related.some(item => item.kind === kind)} onClick={() => act(async () => {
        const converted = checked(await db.rpc("hub_convert_feedback", { feedback_id: id, target_kind: kind }));
        update(converted);
      }, "Feedback converted")}>Convert to {modules[kind].single}</button>)}</div>}
    {(actionError || error) && <p className={styles.error} role="alert">{actionError || error}</p>}
    {report.kind === "bug" && (admin || (member.role === "Team Member" && member.id === report.author)) && <form className={styles.form} onSubmit={event => {
      event.preventDefault();
      const form = event.currentTarget;
      const file = new FormData(form).get("attachment");
      if (file instanceof File) void act(async () => { await uploadAttachment(db, id, file); form.reset(); }, "Attachment uploaded");
    }}>
      <label>Add attachment (10 MB max)<input type="file" name="attachment" required accept={attachmentAccept} /></label>
      <button disabled={busy}>Upload attachment</button>
    </form>}
    {!activity && !error && <p role="status">Loading activity…</p>}
    {activity && <>
      {feature && <button disabled={busy || member.role === "Viewer"} aria-pressed={activity.voted} onClick={() => act(async () => {
        checked(await (activity.voted
          ? db.from("hub_votes").delete().eq("report_id", id).eq("member_id", member.id)
          : db.from("hub_votes").upsert({ report_id: id, member_id: member.id }, { ignoreDuplicates: true })));
      })}>{activity.voted ? "Upvoted" : "Upvote"} · {activity.votes}</button>}
      {activity.related.length > 0 && <div><strong>Converted reports</strong>{activity.related.map(item => <p key={item.id}><button onClick={() => update(item)}>{reportCode(item)} · {item.status}</button></p>)}</div>}
      {activity.files.length > 0 && <div><strong>Attachments</strong>{activity.files.map((file, index) => <p key={file}><button onClick={async () => {
        setError("");
        try {
          const data = checked(await db.storage.from("hub-attachments").download(id + "/" + file));
          if (!data) throw new Error("Attachment is unavailable.");
          const url = URL.createObjectURL(data);
          const link = document.createElement("a");
          link.href = url; link.download = "attachment-" + (index + 1) + "." + file.split(".").at(-1); link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (e) { setError((e as Error).message); }
      }}><ArrowDownToLine size={15} /> Download attachment {index + 1}</button></p>)}</div>}
      <div className={styles.timeline}><h3>Status history</h3>{activity.history.map(entry => <div key={entry.id}><Badge value={entry.status} />
        <small>{entry.previous ? "From " + entry.previous + " · " : ""}{entry.actor ? person(entry.actor) + " · " : ""}{formatDate(entry.created_at)}</small></div>)}</div>
      {(canComment || activity.comments.length > 0) && <div className={styles.timeline}><h3>{feature ? "Discussion" : "Internal notes"}</h3>
        {activity.comments.map(entry => <div key={entry.id}><small>{person(entry.author)} · {formatDate(entry.created_at)}{entry.resolution ? " · Resolution note" : ""}</small><p className={styles.preserve}>{entry.body}</p></div>)}
        {canComment && <form className={styles.form} onSubmit={e => {
          e.preventDefault();
          void act(async () => {
            checked(await db.from("hub_comments").insert({ report_id: id, body: comment.trim(), resolution }));
            setComment(""); setResolution(false);
          }, "Comment added");
        }}>
          <label>New comment<textarea value={comment} required maxLength={6000} rows={3} onChange={e => setComment(e.target.value)} /></label>
          {technical && <label className={styles.inline}><input type="checkbox" checked={resolution} onChange={e => setResolution(e.target.checked)} /> Resolution note</label>}
          <button disabled={busy || !comment.trim()}>Post comment</button>
        </form>}
      </div>}
    </>}
  </div></Modal>;
}
