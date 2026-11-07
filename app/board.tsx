"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Building2, Check, ChevronDown, ChevronRight, Circle, CircleCheck, Folder, Inbox, LayoutList, Paperclip, Plus, Search, Trash2, X } from "lucide-react";
import { CleanupCatalog, ConfirmAction } from "./cleanup-controls";
import ProductMark from "./product-mark";
import Clients from "./clients";
import ProfileOption from "./profile";
import { ListSkeleton, MotionResults, Notice, useNotice } from "./ui-feedback";
import { attachmentTypes, maxAttachmentBytes, readAttachments, removeAttachments, saveAttachments } from "./board-attachments";
import styles from "./board.module.css";
import { createClient } from "./supabase-client";
import type { User } from "@supabase/supabase-js";

const defaultSections = ["Bug report", "Update report", "User feedback"];
const sectionsKey = "product-hub.sections.v1";
const typesKey = "product-log.report-types.v2";
const projectsKey = "product-hub.projects.v1";
type StoredFile = { path: string; name: string; type: string };
type Report = { id: string; title: string; details: string; done: boolean; deleted_at?: string | null; attachmentCount?: number; type?: string; project?: string; attachments?: StoredFile[]; author?: string; posted_by?: string; created_at?: string; updated_by?: string; updated_at?: string };
const key = "product-hub.board.v1";
const filters = ["All", "Open", "Done", "Trash"] as const;
const statusIcons = { All: LayoutList, Open: Circle, Done: CircleCheck, Trash: Trash2 };
type Filter = typeof filters[number];

function readSections(): string[] {
  const stored = localStorage.getItem(typesKey);
  const saved: unknown = JSON.parse(stored ?? localStorage.getItem(sectionsKey) ?? "[]");
  if (!Array.isArray(saved) || !saved.every(name => typeof name === "string")) {
    throw new Error("Invalid section data");
  }
  return stored !== null ? saved : [...defaultSections, ...saved];
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
  const [canManageClients, setCanManageClients] = useState(false);
  const [authError, setAuthError] = useState("");
  const [registering, setRegistering] = useState(false);
  const [authNotice, setAuthNotice] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [reports, setReports] = useState<Report[]>([]);
  const [filter, setFilter] = useState<Filter>("All");
  const [area, setArea] = useState<"reports" | "clients">("reports");
  const [typeFilter, setTypeFilter] = useState("");
  const [search, setSearch] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
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
  const [updatingId, setUpdatingId] = useState("");
  const statusRequest = useRef(false);
  const { notice, notify, dismiss } = useNotice();
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
    if (new URLSearchParams(window.location.search).has("auth_error")) {
      setAuthError("Google sign-in couldn’t finish. Please try again.");
      history.replaceState(history.state, "", window.location.pathname + window.location.hash);
    }
    const { data: { subscription } } = db.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setAuthReady(true);
    });
    return () => subscription.unsubscribe();
  }, [db]);

  async function signInWithGoogle() {
    if (!db || googleBusy) return;
    setGoogleBusy(true);
    setAuthError("");
    try {
      const callback = new URL("/auth/callback", window.location.origin);
      const report = window.location.hash.match(/^#report=([a-f0-9-]{36})$/i)?.[1];
      if (report) callback.searchParams.set("report", report);
      const result = await db.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: callback.href, queryParams: { prompt: "select_account" } },
      });
      if (result.error) throw result.error;
    } catch {
      setAuthError("Couldn’t start Google sign-in. Check that Google is enabled for this workspace.");
      setGoogleBusy(false);
    }
  }

  const userId = user?.id;
  useEffect(() => {
    if (db) {
      let active = true;
      setReady(false);
      setReports([]);
      setAdmin(false);
      setCanManageClients(false);
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
            setCanManageClients(["Admin", "Developer", "Team Member"].includes(member.data.role));
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
      if (event.key === key || event.key === sectionsKey || event.key === typesKey || event.key === projectsKey || event.key === null) load();
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
      if (report.deleted_at) setFilter("Trash");
      setArea("reports");
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
    setAuthNotice("");
    try {
      const email = String(data.get("email")).trim();
      const password = String(data.get("password"));
      if (registering) {
        if (!/^[^@\s]+@gmail\.com$/i.test(email)) {
          setAuthError("Use a gmail.com address to create an account.");
          return;
        }
        const name = String(data.get("name")).trim();
        if (!name) { setAuthError("Enter your name."); return; }
        const result = await db.auth.signUp({ email, password, options: { data: { name } } });
        if (result.error) setAuthError("Couldn’t create your account. Check your details and try again.");
        else setAuthNotice("Check your Gmail inbox and confirm your email, then return here to sign in.");
      } else {
        const result = await db.auth.signInWithPassword({ email, password });
        if (result.error) setAuthError("Couldn’t sign in. Check your email and password.");
      }
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
        notify("Report type created.");
        return;
      }
      const sections = readSections();
      if (sections.some(section => section.toLowerCase() === name.toLowerCase())) {
        setSectionError("A report type with this name already exists.");
        return;
      }
      sections.push(name);
      localStorage.setItem(typesKey, JSON.stringify(sections));
      setReportTypes(sections);
      form.reset();
      sectionDialog.current?.close();
      notify("Report type created.");
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
      setNewReportId(editing?.id ?? id);
      notify(editing ? "Report updated." : "Report created.");
      setSearch("");
      form.reset();
      setProjectChoice("");
      setTypeFilter("");
      setProjectFilter("");
      if (filter === "Done") setFilter("Open");
      if (filter === "Trash") setFilter("All");
      dialog.current?.close();
    } catch {
      setFormError("Couldn’t save the report. Check your connection or try smaller attachments.");
    } finally {
      setSaving(false);
    }
  }

  async function toggle(report: Report) {
    if (statusRequest.current) return;
    statusRequest.current = true;
    setUpdatingId(report.id);
    try {
      if (!db) {
        if (!update(current => current.map(item => item.id === report.id
          ? { ...item, done: !report.done, updated_at: new Date().toISOString() } : item))) return;
      } else {
        const result = await db.from("board_reports").update({ done: !report.done }).eq("id", report.id).select().single();
        if (result.error) throw result.error;
        setReports(current => current.map(item => item.id === report.id ? result.data as Report : item));
      }
      setNewReportId(report.id);
      notify(report.done ? "Report reopened." : "Report marked done.");
    } catch {
      setError("Couldn’t update the report status. Try again.");
    } finally {
      statusRequest.current = false;
      setUpdatingId("");
    }
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

  const activeReports = reports.filter(report => !report.deleted_at);
  const completed = activeReports.filter(report => report.done).length;
  const statusCounts = { All: activeReports.length, Open: activeReports.length - completed, Done: completed, Trash: reports.length - activeReports.length };
  const projects = Array.from(new Set([...savedProjects, ...reports.flatMap(report => report.project ? [report.project] : [])])).sort((a, b) => a.localeCompare(b));

  async function manageReport(report: Report, action: "trash" | "restore" | "purge") {
    try {
      if (db) {
        const result = await db.rpc("cleanup_report", { p_id: report.id, p_action: action });
        if (result.error) throw new Error(result.error.message);
        setReports(current => action === "purge" ? current.filter(item => item.id !== report.id) : current.map(item => item.id === report.id ? result.data as Report : item));
      } else {
        const stored = readReports().find(item => item.id === report.id);
        if (!stored) throw new Error("Report unavailable.");
        if (action === "restore" && stored.deleted_at && Date.now() - new Date(stored.deleted_at).getTime() > 30 * 86400000) throw new Error("The 30-day restore period has ended.");
        if (action === "purge" && !stored.deleted_at) throw new Error("Move this report to Trash first.");
        if (action === "purge" && (stored.attachmentCount ?? 0) > 0) throw new Error("Remove attachments before permanently deleting this report.");
        if (!update(current => action === "purge" ? current.filter(item => item.id !== report.id) : current.map(item => item.id === report.id ? { ...item, deleted_at: action === "trash" ? item.deleted_at ?? new Date().toISOString() : null } : item))) throw new Error("Couldn’t save the change.");
      }
      detailDialog.current?.close();
      notify(action === "trash" ? "Report moved to Trash." : action === "restore" ? "Report restored." : "Report permanently deleted.", action === "trash" ? () => { void manageReport(report, "restore").catch(() => {}); } : undefined);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Couldn’t manage this report.");
      throw failure;
    }
  }

  async function deleteCatalog(kind: "project" | "type", name: string) {
    if (db) {
      const result = await db.rpc("delete_catalog_entry", { p_kind: kind, p_name: name });
      if (result.error) throw new Error(result.error.message);
    } else {
      if (readReports().some(report => (kind === "project" ? report.project : report.type)?.toLowerCase() === name.toLowerCase())) throw new Error("This entry is still linked to reports, including Trash.");
      localStorage.setItem(kind === "project" ? projectsKey : typesKey, JSON.stringify((kind === "project" ? readProjects() : readSections()).filter(item => item !== name)));
    }
    if (kind === "project") { setSavedProjects(current => current.filter(item => item !== name)); setProjectFilter(""); }
    else { setReportTypes(current => current.filter(item => item !== name)); setTypeFilter(""); }
    notify("Unused entry deleted.");
  }

  async function removeFile(report: Report, index: number) {
    let next: Report;
    if (db) {
      const path = report.attachments?.[index]?.path;
      if (!path) throw new Error("Attachment unavailable.");
      const result = await db.rpc("cleanup_report", { p_id: report.id, p_action: "remove_attachment", p_path: path });
      if (result.error) throw new Error(result.error.message);
      next = result.data as Report;
      setReports(current => current.map(item => item.id === report.id ? next : item));
      const cleanup = await db.storage.from("board-attachments").remove([path]);
      if (cleanup.error) setError("Attachment removed from the report, but storage cleanup failed. Contact an admin to clean the detached file.");
    } else {
      const files = await readAttachments(report.id) ?? [];
      if (!files[index]) throw new Error("Attachment unavailable.");
      await saveAttachments(report.id, files.filter((_, position) => position !== index));
      next = { ...report, attachmentCount: files.length - 1 };
      if (!update(current => current.map(item => item.id === report.id ? next : item))) {
        await saveAttachments(report.id, files);
        throw new Error("Couldn’t save attachment removal.");
      }
    }
    setSelected(next);
    notify("Attachment removed.");
  }

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
      notify("Project created.");
    } catch {
      setProjectError("Couldn’t save the project. Try again.");
    } finally {
      setCreatingProject(false);
    }
  }
  const searchTerms = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const visible = reports.filter(report =>
    (filter === "Trash" ? Boolean(report.deleted_at) : !report.deleted_at && (filter === "All" || report.done === (filter === "Done")))
    && (!typeFilter || report.type === typeFilter)
    && (!projectFilter || report.project === projectFilter)
    && searchTerms.every(term => (report.title + " " + report.details).toLocaleLowerCase().includes(term)));

  if (db && !user) return <div className={styles.shell + " " + styles.authLayout}><aside className={styles.authStory}>
    <div className={styles.loginBrand}><ProductMark /><strong>Product Log</strong></div>
    <div><h2>Good products start with a clear picture.</h2><p>Keep your team's reports, project updates, and client relationships in one place.</p>
      <div className={styles.authFeatures}><span><LayoutList size={20} /> Reports with context</span><span><Folder size={20} /> Projects, connected</span><span><Building2 size={20} /> Clients, close at hand</span></div>
    </div><small>Your team's everyday workspace.</small>
  </aside><main className={styles.authMain}>
    <section className={styles.panel + " " + styles.signIn}>
      <div className={styles.loginBrand}><ProductMark /><strong>Product Log</strong></div>
      <h1>{registering ? "Create your account" : "Welcome back"}</h1>
      <p className={styles.authIntro}>{registering ? "Set up your Product Log account." : "Sign in to your Product Log workspace."}</p>
      {authReady ? <>
      <button className={styles.googleButton} disabled={googleBusy || signingIn} onClick={() => void signInWithGoogle()}>
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36Z" />
          <path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.05.96-3.38.96-2.6 0-4.81-1.76-5.6-4.12H3.06v2.59A10 10 0 0 0 12 22Z" />
          <path fill="#FBBC05" d="M6.4 13.92a6 6 0 0 1 0-3.84V7.49H3.06a10 10 0 0 0 0 9.02l3.34-2.59Z" />
          <path fill="#EA4335" d="M12 5.96c1.47 0 2.79.5 3.82 1.49l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.94 5.49l3.34 2.59A5.99 5.99 0 0 1 12 5.96Z" />
        </svg>
        {googleBusy ? "Connecting to Google…" : "Continue with Google"}
      </button>
      <p className={styles.authDivider}>or use email</p>
      <form onSubmit={signIn}>
        {registering && <label>Name<input name="name" autoComplete="name" required maxLength={120} disabled={signingIn} /></label>}
        <label>Email<input name="email" type="email" autoComplete="username" required disabled={signingIn} /></label>
        <label>Password<input name="password" type="password" autoComplete={registering ? "new-password" : "current-password"} minLength={registering ? 12 : undefined} required disabled={signingIn} /></label>
        {registering && <p>Use a Gmail address and a password of at least 12 characters.</p>}
        {authError && <p role="alert" className={styles.error}>{authError}</p>}
        {authNotice && <p role="status">{authNotice}</p>}
        <button className={styles.primary} disabled={signingIn}>{signingIn ? "Please wait…" : registering ? "Create account" : "Sign in"}</button>
        <button className={styles.secondary} type="button" disabled={signingIn} onClick={() => { setRegistering(value => !value); setAuthError(""); setAuthNotice(""); }}>{registering ? "Back to sign in" : "Sign up with Gmail"}</button>
      </form></> : <p>Checking your session…</p>}
    </section>
  </main></div>;

  return <div className={styles.shell + " " + styles.workspace}>
    <Notice notice={notice} dismiss={dismiss} />
    <a href="#workspace-content" className={styles.skipLink}>Skip to content</a>
    <aside className={styles.sidebar} aria-label="Workspace">
      <strong><ProductMark /> Product Log</strong>
      <div className={styles.navigation}>
        <span className={styles.navLabel}>Workspace</span>
        <div className={styles.filters} role="group" aria-label="Workspace pages">
          <button type="button" aria-pressed={area === "reports"} onClick={() => setArea("reports")}><LayoutList size={18} aria-hidden="true" /><span>Reports</span><small>{statusCounts.All}</small></button>
          <button type="button" aria-pressed={area === "clients"} onClick={() => setArea("clients")}><Building2 size={17} aria-hidden="true" /><span>Clients</span></button>
        </div>
        <div className={styles.projectNavigation}>
          <div className={styles.projectHeading}><span>Projects</span><button type="button" disabled={!ready} aria-label="Create project" onClick={() => projectDialog.current?.showModal()}><Plus size={16} /></button></div>
          {projects.length ? projects.map(project => <button key={project} type="button" aria-pressed={area === "reports" && projectFilter === project} onClick={() => { setArea("reports"); setProjectFilter(current => current === project ? "" : project); setFilter("All"); }}><Folder size={16} aria-hidden="true" /><span>{project}</span></button>) : <p>Create a project to organize your reports.</p>}
        </div>
      </div>
      <div className={styles.workspaceInfo}>
        <ProfileOption key={userId ?? "local"} db={db} userId={userId} email={user?.email} />
        {db ? <button className={styles.secondary} onClick={async () => {
          const result = await db.auth.signOut();
          if (result.error) setError("Couldn’t sign out.");
        }}>Sign out</button> : <span><i /> Only on this device</span>}
      </div>
    </aside>
    <main className={styles.main} id="workspace-content" tabIndex={-1}>
      <div className={styles.contextBar}><span>Workspace <ChevronRight size={14} aria-hidden="true" /> <strong>{area === "clients" ? "Clients" : "Reports"}</strong></span><span className={styles.workspaceMode}><i />{shared ? "Team workspace" : "Personal workspace"}</span></div>
      <div className={styles.pageContent} key={area}>
      {area === "clients" ? (ready ? <Clients key={userId ?? "local"} db={db} canManage={canManageClients} admin={admin} /> : <p role="status">{error || "Loading workspace…"}</p>) : <>
      <header className={styles.hero}>
        <div><h1 id="board-title">Reports</h1>
          <p>A clear view of what needs attention and what's moving forward.</p>
        </div>
        <button className={styles.primary} disabled={!ready} onClick={() => dialog.current?.showModal()}><Plus size={18} aria-hidden="true" /> New report</button>
      </header>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <section className={styles.panel} aria-labelledby="reports-title">
        <div className={styles.toolbar}>
          <div className={styles.statusTabs} role="group" aria-label="Report status">{filters.map(option => {
            const Icon = statusIcons[option];
            return <button key={option} type="button" aria-pressed={filter === option} onClick={() => setFilter(option)}><Icon size={16} aria-hidden="true" />{option === "All" ? "All reports" : option}<span>{statusCounts[option]}</span></button>;
          })}</div>
          <div className={styles.toolbarActions}>
            <button className={styles.secondary} type="button" disabled={!ready} popoverTarget="board-manage">Organize <ChevronDown size={15} aria-hidden="true" /></button>
            <div className={styles.manageMenu} id="board-manage" popover="auto" ref={manageMenu}>
              <button type="button" onClick={() => { manageMenu.current?.hidePopover(); projectDialog.current?.showModal(); }}>New project</button>
              <button type="button" onClick={() => { manageMenu.current?.hidePopover(); sectionDialog.current?.showModal(); }}>Add report type</button>
            </div>
        <CleanupCatalog label={db && !admin ? "Manage projects" : "Manage lists"}>
          {([['project', projects], ['type', reportTypes]] as const).filter(([kind]) => kind === "project" || !db || admin).map(([kind, names]) => <section className={styles.catalogGroup} key={kind}><h3>{kind === "project" ? "Projects" : "Report types"}</h3>{names.map(name => {
            const used = reports.some(report => (kind === "project" ? report.project : report.type)?.toLowerCase() === name.toLowerCase());
            return <div className={styles.catalogRow} key={name}><span>{name}<small>{used ? "In use" : "Unused"}</small></span><ConfirmAction label="Delete" title={`Delete ${name}?`} description="This permanently deletes the unused entry." disabled={used} onConfirm={() => deleteCatalog(kind, name)} /></div>;
          })}</section>)}
        </CleanupCatalog>
          </div>
        </div>
        {filter === "Trash" && <p className={styles.trashHelp}>Restore reports within 30 days. Only admins can permanently delete them; attached files must be removed first. Reports are not automatically purged.</p>}
        <h2 id="reports-title" className={styles.visuallyHidden}>{filter === "All" ? "All reports" : filter + " reports"}</h2>
        <div className={styles.reportFilters + " " + styles.searchFilters}>
          <label>Search reports<div className={styles.reportSearch}>
            <Search size={17} aria-hidden="true" />
            <input ref={searchInput} type="search" aria-label="Search reports" value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Search titles and descriptions"
              onKeyDown={event => { if (event.key === "Escape" && search) { event.preventDefault(); setSearch(""); } }} />
            {search && <button type="button" aria-label="Clear search" onClick={() => { setSearch(""); searchInput.current?.focus(); }}><X size={16} aria-hidden="true" /></button>}
          </div></label>
          <label>Report type<select value={typeFilter} onChange={event => setTypeFilter(event.target.value)}>
            <option value="">All types</option>
            {reportTypes.map(type => <option key={type}>{type}</option>)}
          </select></label>
          <label>Project<select value={projectFilter} onChange={event => setProjectFilter(event.target.value)}>
            <option value="">All projects</option>
            {projects.map(project => <option key={project}>{project}</option>)}
          </select></label>
        </div>
        <div className={styles.resultsSummary} aria-live="polite"><span>{ready ? `${visible.length} report${visible.length === 1 ? "" : "s"}` : "Loading reports…"}{projectFilter && ` in ${projectFilter}`}</span>{(search || projectFilter || typeFilter) && <button type="button" onClick={() => { setSearch(""); setProjectFilter(""); setTypeFilter(""); }}>Reset filters <X size={13} aria-hidden="true" /></button>}</div>
        <MotionResults changeKey={JSON.stringify([filter, typeFilter, projectFilter, search, ready])}>
        {!ready && !error ? <ListSkeleton label="Loading reports" /> : visible.length ? <ul className={styles.list}>{visible.map(report => <li key={report.id}
          data-new={report.id === newReportId} onAnimationEnd={event => {
            if (event.target === event.currentTarget && report.id === newReportId) setNewReportId("");
          }}>
          <button className={styles.status} disabled={!ready || Boolean(updatingId) || Boolean(report.deleted_at)} aria-busy={updatingId === report.id} aria-label={report.title + " completed"} aria-pressed={report.done}
            onClick={() => void toggle(report)}>
            {updatingId === report.id ? <span className={styles.spinner} aria-hidden="true" /> : report.done ? <Check size={20} /> : <Circle size={20} />}
          </button>
          <button className={styles.reportLink} type="button" onClick={() => { setSelected(report); detailDialog.current?.showModal(); }}>
            <span><strong>{report.title}</strong><small>
              <span>{report.project ?? "No project"}</span>
              <span className={styles.typeChip}>{report.type ?? "Uncategorized"}</span>
              {Boolean(report.attachments?.length ?? report.attachmentCount) && <><Paperclip size={14} aria-hidden="true" /> {report.attachments?.length ?? report.attachmentCount} files</>}
            </small></span>
            <span className={styles.rowStatus} data-done={report.done}>{report.deleted_at ? "In Trash" : report.done ? "Done" : "Open"}</span>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </li>)}</ul> : <div className={styles.empty}>
          <span className={styles.emptyIcon}><Inbox size={30} aria-hidden="true" /></span>
          <h3>{error && !ready ? "Reports unavailable" : !ready ? "Loading reports…" : reports.length ? "No matching reports" : "Your next improvement starts here"}</h3>
          {ready && <p>{reports.length ? "Try a different search or clear your filters." : "Add a bug, an update, or user feedback."}</p>}
          {ready && (reports.length
            ? <button className={styles.secondary} onClick={() => { setFilter("All"); setTypeFilter(""); setProjectFilter(""); setSearch(""); }}>Clear search and filters</button>
            : <button className={styles.secondary} onClick={() => dialog.current?.showModal()}><Plus size={16} /> Create first report</button>)}
        </div>}
        </MotionResults>
      </section>
      </>}
      </div>
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
          {!selected.deleted_at && (!db || admin || selected.author === userId) && <button className={styles.secondary} onClick={() => {
            setEditing(selected);
            setProjectChoice(selected.project ? "project:" + selected.project : "");
            detailDialog.current?.close();
            dialog.current?.showModal();
          }}>Edit report</button>}
          {db && <button className={styles.secondary} onClick={() => void copyReportLink(selected.id)}>Copy report link</button>}
          {(!db || canManageClients && (admin || selected.author === userId)) && (selected.deleted_at ? <>
            <button className={styles.secondary} disabled={Date.now() - new Date(selected.deleted_at).getTime() > 30 * 86400000} onClick={() => void manageReport(selected, "restore").catch(() => {})}>Restore report</button>
            {(!db || admin) && <ConfirmAction label="Delete permanently" title="Permanently delete report?" description="This cannot be undone. Remove attached files first." disabled={Boolean(selected.attachments?.length ?? selected.attachmentCount)} onConfirm={() => manageReport(selected, "purge")} />}
          </> : <ConfirmAction label="Move to Trash" title="Move report to Trash?" description="The report and its attachments will stay recoverable for 30 days." onConfirm={() => manageReport(selected, "trash")} />)}
        </div>
        {linkMessage && <p role="status">{linkMessage}</p>}
        {Boolean(selected.attachments?.length ?? selected.attachmentCount) && <Attachments key={selected.id + ":" + (selected.attachments?.length ?? selected.attachmentCount)} report={selected} db={db} onRemove={(!db || canManageClients && (admin || selected.author === userId)) ? index => removeFile(selected, index) : undefined} />}
      </>}
    </dialog>
  </div>;
}

function Attachments({ report, db, onRemove }: { report: Report; db: ReturnType<typeof createClient> | null; onRemove?: (index: number) => Promise<void> }) {
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
    {previews.map(({ file, url }, index) => <figure key={url}>
      {file.type.startsWith("video/")
        ? <video src={url} controls preload="metadata" aria-label={file.name} />
        : <img src={url} alt={file.name} />}
      <figcaption><a href={url} download={file.name}>{file.name}</a>{onRemove && <ConfirmAction label="Remove attachment" title={`Remove ${file.name}?`} description="This permanently removes the attachment from the report." onConfirm={() => onRemove(index)} />}</figcaption>
    </figure>)}
  </section>;
}
