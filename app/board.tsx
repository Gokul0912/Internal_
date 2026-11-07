"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, ChevronRight, Circle, CircleCheck, Inbox, Layers3, LayoutList, Paperclip, Plus, X } from "lucide-react";
import { attachmentTypes, maxAttachmentBytes, readAttachments, removeAttachments, saveAttachments } from "./board-attachments";
import styles from "./board.module.css";
import { createClient } from "./supabase-client";
import type { User } from "@supabase/supabase-js";

const defaultSections = ["Bug report", "Update report", "User feedback"];
const sectionsKey = "product-hub.sections.v1";
const projectsKey = "product-hub.projects.v1";
type StoredFile = { path: string; name: string; type: string };
type Report = { id: string; title: string; details: string; done: boolean; attachmentCount?: number; type?: string; project?: string; attachments?: StoredFile[]; author?: string; posted_by?: string; created_at?: string; updated_by?: string; updated_at?: string };
const key = "product-hub.board.v1";
const filters = ["All", "Open", "Done"] as const;
const statusIcons = { All: LayoutList, Open: Circle, Done: CircleCheck };
type Filter = typeof filters[number];

function readSections(): string[] {
  const saved: unknown = JSON.parse(localStorage.getItem(sectionsKey) ?? "[]");
  if (!Array.isArray(saved) || !saved.every(name => typeof name === "string")) {
    throw new Error("Invalid section data");
  }
  return [...defaultSections, ...saved];
}

function readProjects(): string[] {
  const saved: unknown = JSON.parse(localStorage.getItem(projectsKey) ?? "[]");
  if (!Array.isArray(saved) || !saved.every(name => typeof name === "string")) {
    throw new Error("Invalid project data");
  }
  return saved;
}

function readReports(): Report[] {
  const reports: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
  if (!Array.isArray(reports) || !reports.every(report => report
    && typeof report.id === "string" && typeof report.title === "string"
    && typeof report.details === "string" && typeof report.done === "boolean")) {
    throw new Error("Invalid report data");
  }
  return reports;
}

export default function Board({ shared }: { shared: boolean }) {
  const [db] = useState(() => shared ? createClient() : null);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(!shared);
  const [admin, setAdmin] = useState(false);
  const [authError, setAuthError] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [reports, setReports] = useState<Report[]>([]);
  const [filter, setFilter] = useState<Filter>("All");
  const [typeFilter, setTypeFilter] = useState("");
  const [reportTypes, setReportTypes] = useState(defaultSections);
  const [sectionError, setSectionError] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [savedProjects, setSavedProjects] = useState<string[]>([]);
  const [projectError, setProjectError] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const [projectChoice, setProjectChoice] = useState("");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [newReportId, setNewReportId] = useState("");
  const [selected, setSelected] = useState<Report | null>(null);
  const [editing, setEditing] = useState<Report | null>(null);
  const [linkMessage, setLinkMessage] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const sectionDialog = useRef<HTMLDialogElement>(null);
  const projectDialog = useRef<HTMLDialogElement>(null);
  const detailDialog = useRef<HTMLDialogElement>(null);
  const manageMenu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!db) return;
    const { data: { subscription } } = db.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setAuthReady(true);
    });
    return () => subscription.unsubscribe();
  }, [db]);

  const userId = user?.id;
  useEffect(() => {
    if (db) {
      let active = true;
      setReady(false);
      setReports([]);
      setAdmin(false);
      setError("");
      if (userId) {
        Promise.all([
          db.from("hub_members").select("role").eq("id", userId).maybeSingle(),
          db.from("board_reports").select("*").order("created_at", { ascending: false }),
          db.from("board_types").select("name").order("name"),
          db.from("board_projects").select("name").order("name"),
        ]).then(([member, records, types, projectRecords]) => {
          if (!active) return;
          if (member.error || records.error || types.error || projectRecords.error) {
            setError("The shared board couldn’t load. Check the workspace setup and try again.");
          } else if (!member.data) {
            setError("Your account needs an invitation to this workspace.");
          } else {
            setAdmin(member.data.role === "Admin");
            setReports(records.data as Report[]);
            setReportTypes(types.data.map(type => type.name));
            setSavedProjects(projectRecords.data.map(project => project.name));
            setReady(true);
          }
        }).catch(() => { if (active) setError("The shared board couldn’t load."); });
      }
      return () => { active = false; };
    }
    function load() {
      try {
        setReports(readReports());
        setReportTypes(readSections());
        setSavedProjects(readProjects());
        setReady(true);
        setError("");
      } catch {
        setReady(false);
        setError("This browser couldn’t load your reports.");
      }
    }
    function sync(event: StorageEvent) {
      if (event.key === key || event.key === sectionsKey || event.key === projectsKey || event.key === null) load();
    }
    load();
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [db, userId]);

  useEffect(() => {
    if (!db || !ready) return;
    function openLinkedReport() {
      const id = window.location.hash.match(/^#report=([a-f0-9-]+)$/i)?.[1];
      if (!id) return;
      const report = reports.find(item => item.id === id);
      if (!report) {
        setError("This report is unavailable.");
        return;
      }
      setSelected(report);
      if (!detailDialog.current?.open && !dialog.current?.open) detailDialog.current?.showModal();
    }
    openLinkedReport();
    window.addEventListener("hashchange", openLinkedReport);
    return () => window.removeEventListener("hashchange", openLinkedReport);
  }, [db, ready, reports]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!db || signingIn) return;
    const data = new FormData(event.currentTarget);
    setSigningIn(true);
    setAuthError("");
    try {
      const result = await db.auth.signInWithPassword({ email: String(data.get("email")).trim(), password: String(data.get("password")) });
      if (result.error) setAuthError("Couldn’t sign in. Check your email and password.");
    } catch {
      setAuthError("Couldn’t reach the sign-in service.");
    } finally {
      setSigningIn(false);
    }
  }

  async function addSection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = String(new FormData(form).get("section") ?? "").trim().replace(/\s+/g, " ");
    if (!name || name.length > 50) {
      setSectionError("Enter a type name up to 50 characters.");
      return;
    }
    try {
      if (db) {
        const result = await db.from("board_types").insert({ name });
        if (result.error) {
          setSectionError(result.error.code === "23505" ? "A report type with this name already exists." : "Couldn’t save the report type.");
          return;
        }
        setReportTypes(current => [...current, name]);
        form.reset();
        sectionDialog.current?.close();
        return;
      }
      const sections = readSections();
      if (sections.some(section => section.toLowerCase() === name.toLowerCase())) {
        setSectionError("A report type with this name already exists.");
        return;
      }
      sections.push(name);
      localStorage.setItem(sectionsKey, JSON.stringify(sections.slice(defaultSections.length)));
      setReportTypes(sections);
      form.reset();
      sectionDialog.current?.close();
    } catch {
      setSectionError("This browser couldn’t save the report type.");
    }
  }

  function update(change: (current: Report[]) => Report[]) {
    try {
      const next = change(readReports());
      localStorage.setItem(key, JSON.stringify(next));
      setReports(next);
      setError("");
      return true;
    } catch {
      setError("This browser couldn’t save the change.");
      return false;
    }
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const title = String(data.get("title")).trim();
    if (!title) return;
    const details = String(data.get("details")).trim();
    const type = reportTypes.find(option => option === data.get("reportType"));
    const projectName = projectChoice === "new"
      ? String(data.get("projectName") ?? "").trim()
      : projects.find(name => projectChoice === "project:" + name);
    if (!type || !projectName || projectName.length > 80) {
      setFormError("Choose a report type and a project. Project names can have up to 80 characters.");
      return;
    }
    const files = editing ? [] : pendingFiles;
    if (files.length > 5 || files.some(file => !attachmentTypes.includes(file.type) || !file.size || file.size > maxAttachmentBytes)) {
      setFormError("Choose up to 5 supported images or videos, each between 1 byte and 25 MB.");
      return;
    }
    const id = crypto.randomUUID();
    setFormError("");
    setSaving(true);
    try {
      if (editing) {
        if (db) {
          const result = await db.from("board_reports").update({ title, details, type, project: projectName })
            .eq("id", editing.id).select().single();
          if (result.error) {
            setFormError("Couldn’t edit this report. Only its author or an admin can change its details.");
            return;
          }
          setReports(current => current.map(item => item.id === editing.id ? result.data as Report : item));
        } else if (!update(current => current.map(item => item.id === editing.id
          ? { ...item, title, details, type, project: projectName, updated_at: new Date().toISOString() } : item))) {
          setFormError("This browser couldn’t save the report.");
          return;
        }
      } else if (db && userId) {
        const uploaded: StoredFile[] = [];
        try {
          for (const file of files) {
            const path = userId + "/" + id + "/" + crypto.randomUUID();
            const result = await db.storage.from("board-attachments").upload(path, file);
            if (result.error) throw result.error;
            uploaded.push({ path, name: file.name, type: file.type });
          }
          const result = await db.from("board_reports").insert({ id, title, details, type, project: projectName, attachments: uploaded }).select().single();
          if (result.error) throw result.error;
          setReports(current => [result.data as Report, ...current]);
        } catch (failure) {
          if (uploaded.length) await db.storage.from("board-attachments").remove(uploaded.map(file => file.path));
          throw failure;
        }
      } else if (db) {
        throw new Error("Sign-in required");
      } else {
        if (files.length) await saveAttachments(id, files);
        if (!update(current => {
          const project = current.find(report => report.project?.toLowerCase() === projectName.toLowerCase())?.project ?? projectName;
          const timestamp = new Date().toISOString();
          return [{ id, title, details, done: false, attachmentCount: files.length, type, project, created_at: timestamp, updated_at: timestamp }, ...current];
        })) {
          if (files.length) await removeAttachments(id);
          setFormError("This browser couldn’t save the report.");
          return;
        }
      }
      if (!editing) setNewReportId(id);
      form.reset();
      setProjectChoice("");
      setTypeFilter("");
      setProjectFilter("");
      if (filter === "Done") setFilter("Open");
      dialog.current?.close();
    } catch {
      setFormError("Couldn’t save the report. Check your connection or try smaller attachments.");
    } finally {
      setSaving(false);
    }
  }

  async function toggle(report: Report) {
    if (!db) {
      update(current => current.map(item => item.id === report.id
        ? { ...item, done: !report.done, updated_at: new Date().toISOString() } : item));
      return;
    }
    const result = await db.from("board_reports").update({ done: !report.done }).eq("id", report.id).select().single();
    if (result.error) setError("Couldn’t update the report status.");
    else setReports(current => current.map(item => item.id === report.id ? result.data as Report : item));
  }

  async function copyReportLink(id: string) {
    const url = new URL(window.location.href);
    url.hash = "report=" + id;
    try {
      await navigator.clipboard.writeText(url.href);
      setLinkMessage("Link copied.");
    } catch {
      setLinkMessage(url.href);
    }
  }

  const completed = reports.filter(report => report.done).length;
  const statusCounts = { All: reports.length, Open: reports.length - completed, Done: completed };
  const projects = Array.from(new Set([...savedProjects, ...reports.flatMap(report => report.project ? [report.project] : [])])).sort((a, b) => a.localeCompare(b));

  async function addProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creatingProject) return;
    const form = event.currentTarget;
    const name = String(new FormData(form).get("project") ?? "").trim();
    if (!name || name.length > 80) {
      setProjectError("Enter a project name up to 80 characters.");
      return;
    }
    setCreatingProject(true);
    setProjectError("");
    try {
      const registered = db ? savedProjects : readProjects();
      const existing = db ? projects : [...registered, ...readReports().map(report => report.project)];
      if (existing.some(project => project?.toLowerCase() === name.toLowerCase())) {
        setProjectError("A project with this name already exists.");
        return;
      }
      if (db) {
        const result = await db.from("board_projects").insert({ name });
        if (result.error?.code === "23505") {
          setProjectError("A project with this name already exists.");
          return;
        }
        if (result.error) throw result.error;
        setSavedProjects(current => [...current, name]);
      } else {
        const next = [...registered, name];
        localStorage.setItem(projectsKey, JSON.stringify(next));
        setSavedProjects(next);
      }
      form.reset();
      projectDialog.current?.close();
    } catch {
      setProjectError("Couldn’t save the project. Try again.");
    } finally {
      setCreatingProject(false);
    }
  }
  const visible = reports.filter(report =>
    (filter === "All" || report.done === (filter === "Done"))
    && (!typeFilter || report.type === typeFilter)
    && (!projectFilter || report.project === projectFilter));

  if (db && !user) return <div className={styles.shell}><main className={styles.main}>
    <section className={styles.panel + " " + styles.signIn}>
      <h1>Sign in to Product Log</h1>
      {authReady ? <form onSubmit={signIn}>
        <label>Email<input name="email" type="email" autoComplete="username" required /></label>
        <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
        {authError && <p role="alert" className={styles.error}>{authError}</p>}
        <button className={styles.primary} disabled={signingIn}>{signingIn ? "Signing in…" : "Sign in"}</button>
      </form> : <p>Checking your session…</p>}
    </section>
  </main></div>;

  return <div className={styles.shell + " " + styles.workspace}>
    <aside className={styles.sidebar} aria-label="Workspace">
      <strong><Layers3 size={19} aria-hidden="true" /> Product Log</strong>
      <div className={styles.navigation}>
        <span className={styles.navLabel}>Workspace</span>
        <div className={styles.filters} role="group" aria-label="Report status">
          {filters.map(option => {
            const Icon = statusIcons[option];
            return <button key={option} type="button" aria-pressed={filter === option} onClick={() => setFilter(option)}>
              <Icon size={17} aria-hidden="true" /><span>{option === "All" ? "All reports" : option}</span>
              <small aria-hidden="true">{statusCounts[option]}</small>
            </button>;
          })}
        </div>
      </div>
      <div className={styles.workspaceInfo}>
        {db ? <button className={styles.secondary} onClick={async () => {
          const result = await db.auth.signOut();
          if (result.error) setError("Couldn’t sign out.");
        }}>Sign out</button> : <span><i /> Only on this device</span>}
      </div>
    </aside>
    <main className={styles.main}>
      <header className={styles.hero}>
        <div><small>PRODUCT OPERATIONS</small><h1 id="board-title">Report board</h1>
          <p>Track bugs, updates, and feedback across your projects.</p>
        </div>
        <button className={styles.primary} disabled={!ready} onClick={() => dialog.current?.showModal()}><Plus size={18} /> Add report</button>
      </header>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <section className={styles.panel} aria-labelledby="reports-title">
        <div className={styles.toolbar}>
          <div><h2 id="reports-title">{filter === "All" ? "All reports" : filter + " reports"}</h2><p aria-live="polite">{ready ? `${visible.length} of ${reports.length} reports` : "Workspace activity"}</p></div>
          <div>
            <button className={styles.secondary} type="button" disabled={!ready} popoverTarget="board-manage">Manage <ChevronRight size={15} aria-hidden="true" /></button>
            <div className={styles.manageMenu} id="board-manage" popover="auto" ref={manageMenu}>
              <button type="button" onClick={() => { manageMenu.current?.hidePopover(); projectDialog.current?.showModal(); }}>New project</button>
              <button type="button" onClick={() => { manageMenu.current?.hidePopover(); sectionDialog.current?.showModal(); }}>Add report type</button>
            </div>
          </div>
        </div>
        <div className={styles.reportFilters}>
          <label>Report type<select value={typeFilter} onChange={event => setTypeFilter(event.target.value)}>
            <option value="">All types</option>
            {reportTypes.map(type => <option key={type}>{type}</option>)}
          </select></label>
          <label>Project<select value={projectFilter} onChange={event => setProjectFilter(event.target.value)}>
            <option value="">All projects</option>
            {projects.map(project => <option key={project}>{project}</option>)}
          </select></label>
        </div>
        {visible.length ? <ul className={styles.list}>{visible.map(report => <li key={report.id}
          data-new={report.id === newReportId} onAnimationEnd={event => {
            if (event.target === event.currentTarget && report.id === newReportId) setNewReportId("");
          }}>
          <button className={styles.status} disabled={!ready} aria-label={report.title + " completed"} aria-pressed={report.done}
            onClick={() => void toggle(report)}>
            {report.done ? <Check size={20} /> : <Circle size={20} />}
          </button>
          <button className={styles.reportLink} type="button" onClick={() => { setSelected(report); detailDialog.current?.showModal(); }}>
            <span><strong>{report.title}</strong><small>
              <span>{report.project ?? "No project"}</span>
              <span className={styles.typeChip}>{report.type ?? "Uncategorized"}</span>
              {Boolean(report.attachments?.length ?? report.attachmentCount) && <><Paperclip size={14} aria-hidden="true" /> {report.attachments?.length ?? report.attachmentCount} files</>}
            </small></span>
            <span className={styles.rowStatus} data-done={report.done}>{report.done ? "Done" : "Open"}</span>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </li>)}</ul> : <div className={styles.empty}>
          <span className={styles.emptyIcon}><Inbox size={30} aria-hidden="true" /></span>
          <h3>{error && !ready ? "Reports unavailable" : !ready ? "Loading reports…" : reports.length ? "No matching reports" : "No reports yet"}</h3>
          {ready && <p>{reports.length ? "Try a different filter to see more reports." : "Add a bug, an update, or user feedback."}</p>}
          {ready && (reports.length
            ? <button className={styles.secondary} onClick={() => { setFilter("All"); setTypeFilter(""); setProjectFilter(""); }}>Clear filters</button>
            : <button className={styles.secondary} onClick={() => dialog.current?.showModal()}><Plus size={16} /> Create first report</button>)}
        </div>}
      </section>
    </main>
    <dialog className={styles.dialog} ref={projectDialog} aria-labelledby="project-dialog-title"
      onClose={() => setProjectError("")} onCancel={event => { if (creatingProject) event.preventDefault(); }}>
      <form onSubmit={addProject}>
        <div className={styles.dialogHead}>
          <h2 id="project-dialog-title">New project</h2>
          <button type="button" aria-label="Close" disabled={creatingProject} onClick={() => projectDialog.current?.close()}><X size={20} /></button>
        </div>
        <label>Project name<input name="project" autoFocus required maxLength={80} disabled={creatingProject} /></label>
        {projectError && <p className={styles.error} role="alert">{projectError}</p>}
        <button className={styles.primary} type="submit" disabled={creatingProject}>{creatingProject ? "Saving…" : "Create project"}</button>
      </form>
    </dialog>
    <dialog className={styles.dialog} ref={sectionDialog} aria-labelledby="section-title" onClose={() => setSectionError("")}>
      <form onSubmit={addSection}>
        <div className={styles.dialogHead}><h2 id="section-title">Add report type</h2><button type="button" aria-label="Close" onClick={() => sectionDialog.current?.close()}><X size={20} /></button></div>
        <p>Give similar reports a name you can use when filing and filtering them.</p><label>Type name<input name="section" autoFocus required maxLength={50} placeholder="e.g. Feature requests" /></label>
        {sectionError && <p className={styles.error} role="alert">{sectionError}</p>}
        <button className={styles.primary} type="submit">Create report type</button>
      </form>
    </dialog>
    <dialog className={styles.dialog} ref={dialog} aria-labelledby="dialog-title"
      onClose={() => { setFormError(""); setEditing(null); setProjectChoice(""); setPendingFiles([]); }}
      onCancel={event => { if (saving) event.preventDefault(); }}>
      <form onSubmit={add} key={editing?.id ?? "new"}>
        <div className={styles.dialogHead}><h2 id="dialog-title">{editing ? "Edit report" : "Add a report"}</h2><button type="button" disabled={saving} aria-label="Close" onClick={() => dialog.current?.close()}><X size={20} /></button></div>
        <label>Title<input name="title" defaultValue={editing?.title} disabled={saving} autoFocus required pattern={".*\\S.*"} maxLength={120} placeholder="What needs attention?" /></label>
        <label>Details (optional)<textarea name="details" defaultValue={editing?.details} disabled={saving} rows={4} maxLength={2000} placeholder="Add a little context" /></label>
        <div className={styles.reportFields}>
          <label>Report type<select name="reportType" defaultValue={editing?.type ?? ""} disabled={saving} required>
            <option value="" disabled>Choose a type</option>
            {reportTypes.map(type => <option key={type}>{type}</option>)}
          </select></label>
          <label>Project<select value={projectChoice} onChange={event => setProjectChoice(event.target.value)} disabled={saving} required>
            <option value="" disabled>Choose a project</option>
            {projects.map(project => <option key={project} value={"project:" + project}>{project}</option>)}
            <option value="new">Add a project…</option>
          </select></label>
        </div>
        {projectChoice === "new" && <label>Project name<input name="projectName" maxLength={80} disabled={saving} required /></label>}
        {!editing && <>
          <label>Attachments (optional)<input type="file" disabled={saving} accept={attachmentTypes.join(",")} multiple aria-describedby="attachment-limit"
            onChange={event => {
              const next = [...pendingFiles, ...Array.from(event.currentTarget.files ?? [])];
              event.currentTarget.value = "";
              if (next.length > 5 || next.some(file => !attachmentTypes.includes(file.type) || !file.size || file.size > maxAttachmentBytes)) {
                setFormError("Choose up to 5 supported images or videos, each between 1 byte and 25 MB.");
                return;
              }
              setFormError("");
              setPendingFiles(next);
            }} /></label>
          <small id="attachment-limit">JPG, PNG, WebP, GIF, MP4 or WebM. Up to 5 files, 25 MB each.</small>
          {pendingFiles.length > 0 && <ul className={styles.pendingFiles} aria-label="Selected attachments">
            {pendingFiles.map((file, index) => <li key={index}>
              <Paperclip size={15} aria-hidden="true" /><span>{file.name}</span>
              <button type="button" disabled={saving} aria-label={"Remove " + file.name} onClick={() => {
                setPendingFiles(current => current.filter((_, position) => position !== index));
                setFormError("");
              }}><X size={16} aria-hidden="true" /></button>
            </li>)}
          </ul>}
        </>}
        {formError && <p className={styles.error} role="alert">{formError}</p>}
        <button className={styles.primary} disabled={saving} type="submit">{saving && <span className={styles.spinner} aria-hidden="true" />}{saving ? "Saving…" : "Save report"}</button>
      </form>
    </dialog>
    <dialog className={styles.dialog + " " + styles.detail} ref={detailDialog} aria-label="Report details" onClose={() => {
      setSelected(null);
      setLinkMessage("");
      if (window.location.hash.startsWith("#report=")) history.replaceState(history.state, "", window.location.pathname + window.location.search);
    }}>
      <div className={styles.dialogHead}><h2>{selected?.title}</h2><button type="button" autoFocus aria-label="Close report" onClick={() => detailDialog.current?.close()}><X size={20} /></button></div>
      {selected && <>
        <span className={styles.badge} data-done={selected.done}>{selected.done ? "Done" : "Open"}</span>
        <p className={styles.reportMeta}>{selected.type ?? "Uncategorized"} · {selected.project ?? "No project"}</p>
        <p className={styles.description}>{selected.details || "No details added."}</p>
        <dl className={styles.attribution}>
          <div><dt>Posted by</dt><dd>{selected.posted_by ?? "Unknown"}{selected.created_at && <> · <time dateTime={selected.created_at}>{new Date(selected.created_at).toLocaleString()}</time></>}</dd></div>
          <div><dt>Last updated by</dt><dd>{selected.updated_by ?? "Unknown"}{selected.updated_at && <> · <time dateTime={selected.updated_at}>{new Date(selected.updated_at).toLocaleString()}</time></>}</dd></div>
        </dl>
        <div className={styles.detailActions}>
          {(!db || admin || selected.author === userId) && <button className={styles.secondary} onClick={() => {
            setEditing(selected);
            setProjectChoice(selected.project ? "project:" + selected.project : "");
            detailDialog.current?.close();
            dialog.current?.showModal();
          }}>Edit report</button>}
          {db && <button className={styles.secondary} onClick={() => void copyReportLink(selected.id)}>Copy report link</button>}
        </div>
        {linkMessage && <p role="status">{linkMessage}</p>}
        {Boolean(selected.attachments?.length ?? selected.attachmentCount) && <Attachments key={selected.id} report={selected} db={db} />}
      </>}
    </dialog>
  </div>;
}

function Attachments({ report, db }: { report: Report; db: ReturnType<typeof createClient> | null }) {
  const [previews, setPreviews] = useState<{ file: File; url: string }[]>([]);
  const [status, setStatus] = useState("Loading attachments…");

  useEffect(() => {
    let active = true;
    const urls: string[] = [];
    const filesPromise = db
      ? Promise.all((report.attachments ?? []).map(async entry => {
        const result = await db.storage.from("board-attachments").download(entry.path);
        if (result.error) throw result.error;
        return new File([result.data], entry.name, { type: entry.type });
      }))
      : readAttachments(report.id);
    filesPromise.then(files => {
      if (!active) return;
      setPreviews((files ?? []).map(file => {
        const url = URL.createObjectURL(file);
        urls.push(url);
        return { file, url };
      }));
      setStatus(files?.length ? "" : "Attachments are unavailable in this browser.");
    }).catch(() => { if (active) setStatus("Attachments couldn’t be loaded."); });
    return () => {
      active = false;
      urls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [db, report.id, report.attachments]);

  return <section className={styles.attachments} aria-label="Attachments">
    <h3>Attachments</h3>
    {status && <p role="status">{status}</p>}
    {previews.map(({ file, url }) => <figure key={url}>
      {file.type.startsWith("video/")
        ? <video src={url} controls preload="metadata" aria-label={file.name} />
        : <img src={url} alt={file.name} />}
      <figcaption><a href={url} download={file.name}>{file.name}</a></figcaption>
    </figure>)}
  </section>;
}
