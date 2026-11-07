"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { UserRound, X } from "lucide-react";
import type { createClient } from "./supabase-client";
import styles from "./board.module.css";

type Profile = { name: string; job_title: string; department: string; phone: string };
const emptyProfile: Profile = { name: "", job_title: "", department: "", phone: "" };
const key = "product-log.employee-profile.v1";

export default function ProfileOption({ db, userId, email }: {
  db: ReturnType<typeof createClient> | null; userId?: string; email?: string;
}) {
  const [profile, setProfile] = useState<Profile>(emptyProfile);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        let next: Profile;
        if (db && userId) {
          const [member, extra] = await Promise.all([
            db.from("hub_members").select("name").eq("id", userId).single(),
            db.from("employee_profiles").select("job_title,department,phone").eq("member_id", userId).maybeSingle(),
          ]);
          if (member.error || extra.error) throw new Error();
          next = { ...emptyProfile, ...extra.data, name: member.data.name };
        } else {
          next = JSON.parse(localStorage.getItem(key) ?? JSON.stringify(emptyProfile)) as Profile;
          if (!next || !Object.keys(emptyProfile).every(field => typeof next[field as keyof Profile] === "string")) throw new Error();
        }
        if (active) { setProfile(next); setReady(true); }
      } catch { if (active) setMessage("Couldn’t load your profile. Check the profile setup and refresh."); }
    }
    void load();
    return () => { active = false; };
  }, [db, userId]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !ready) return;
    const data = new FormData(event.currentTarget);
    const next = Object.fromEntries(Object.keys(emptyProfile).map(field => [field, String(data.get(field) ?? "").trim()])) as Profile;
    if (!next.name) { setMessage("Enter your name."); return; }
    setBusy(true);
    setMessage("");
    try {
      if (db) {
        const result = await db.rpc("save_employee_profile", {
          p_name: next.name, p_job_title: next.job_title, p_department: next.department, p_phone: next.phone,
        });
        if (result.error) throw result.error;
      } else localStorage.setItem(key, JSON.stringify(next));
      setProfile(next);
      setMessage("Profile saved.");
    } catch { setMessage("Couldn’t save your profile. Please try again."); }
    finally { setBusy(false); }
  }

  return <>
    <button className={styles.profileButton} onClick={() => dialog.current?.showModal()}>
      <span className={styles.companyAvatar} aria-hidden="true">{profile.name ? profile.name.slice(0, 2).toUpperCase() : <UserRound size={18} />}</span>
      <span><strong>{profile.name || "My profile"}</strong><small>View and edit profile</small></span>
    </button>
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="profile-title" onCancel={event => { if (busy) event.preventDefault(); }}>
      <form onSubmit={save}>
        <div className={styles.dialogHead}><h2 id="profile-title">My profile</h2><button type="button" disabled={busy} aria-label="Close profile" onClick={() => dialog.current?.close()}><X size={20} /></button></div>
        {email && <label>Sign-in email<input value={email} readOnly /></label>}
        <label>Name<input name="name" defaultValue={profile.name} required maxLength={120} disabled={!ready || busy} /></label>
        <label>Job title<input name="job_title" defaultValue={profile.job_title} maxLength={100} disabled={!ready || busy} /></label>
        <label>Department<input name="department" defaultValue={profile.department} maxLength={100} disabled={!ready || busy} /></label>
        <label>Phone<input name="phone" type="tel" autoComplete="tel" defaultValue={profile.phone} maxLength={60} disabled={!ready || busy} /></label>
        {message && <p role="status">{message}</p>}
        <button className={styles.primary} disabled={!ready || busy}>{busy ? "Saving…" : "Save profile"}</button>
      </form>
    </dialog>
  </>;
}
