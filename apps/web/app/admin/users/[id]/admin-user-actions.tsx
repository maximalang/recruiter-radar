"use client";

import { useActionState } from "react";

import {
  adminClearTelegram,
  adminGrantAccess,
  adminPausePilot,
  adminPauseProfile,
  adminResumeProfile,
  adminRevokeSessions,
  adminResendLogin,
  adminResendOnboarding,
  adminUpdateClientProfile,
} from "../../admin-actions";
import { COMPANY_SIZE_OPTIONS, INDUSTRY_OPTIONS, ROLE_OPTIONS } from "@/lib/clientProfileOptions";

type State = { ok: boolean; message: string };
const initial: State = { ok: false, message: "" };

export default function AdminUserActions({ userId, workspaceId, profileActive, telegramConfigured, adminGrantActive, profile }: {
  userId: string;
  workspaceId: string | null;
  profileActive: boolean;
  telegramConfigured: boolean;
  adminGrantActive: boolean;
  profile?: {
    agencyName: string; specialization: string | null; targetCity: string | null;
    roles: string[]; industries: string[]; companySizes: string[]; dailyDigestLimit: number;
    thresholds: { hiringIntentMin: number | null; signalFreshnessDays: number | null; minOpenRoles: number | null };
  } | null;
}) {
  const [grant, grantAction, grantPending] = useActionState(adminGrantAccess, initial);
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <form action={grantAction} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
        <input type="hidden" name="userId" value={userId} />
        {workspaceId ? <input type="hidden" name="workspaceId" value={workspaceId} /> : null}
        <label style={labelStyle}>Срок
          <select name="durationDays" defaultValue="7" style={controlStyle}>
            <option value="7">7 дней</option><option value="14">14 дней</option><option value="30">30 дней</option>
            <option value="90">90 дней</option><option value="365">365 дней</option>
          </select>
        </label>
        <label style={labelStyle}>Или точная дата окончания
          <input type="date" name="expiresAt" style={controlStyle} />
        </label>
        <button disabled={grantPending} style={buttonStyle("#1d4ed8")}>{grantPending ? "Сохраняем…" : adminGrantActive ? "Продлить доступ" : "Выдать доступ"}</button>
      </form>
      <ActionForm userId={userId} workspaceId={workspaceId} action={adminPausePilot} label="Отозвать admin-доступ" danger />
      <ActionForm userId={userId} workspaceId={workspaceId} action={profileActive ? adminPauseProfile : adminResumeProfile} label={profileActive ? "Приостановить профиль" : "Включить профиль"} danger={profileActive} />
      {telegramConfigured ? <ActionForm userId={userId} workspaceId={workspaceId} action={adminClearTelegram} label="Отвязать Telegram" danger /> : null}
      <ActionForm userId={userId} action={adminRevokeSessions} label="Отозвать все сессии" danger />
      <ActionForm userId={userId} action={adminResendLogin} label="Отправить ссылку для входа" />
      <ActionForm userId={userId} action={adminResendOnboarding} label="Отправить ссылку на onboarding" />
      {profile ? <ProfileEditForm userId={userId} workspaceId={workspaceId} profile={profile} /> : null}
      {grant.message ? <Result state={grant} /> : null}
    </div>
  );
}

function ProfileEditForm({ userId, workspaceId, profile }: { userId: string; workspaceId: string | null; profile: NonNullable<Parameters<typeof AdminUserActions>[0]['profile']> }) {
  const [state, formAction, pending] = useActionState(adminUpdateClientProfile, initial);
  return <details style={{ borderTop: '1px solid #e2e8f0', paddingTop: 12 }}>
    <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Изменить настройки клиента</summary>
    <form action={formAction} style={{ display: 'grid', gap: 10, marginTop: 12 }}>
      <input type="hidden" name="userId" value={userId} />
      {workspaceId ? <input type="hidden" name="workspaceId" value={workspaceId} /> : null}
      <label style={labelStyle}>Агентство<input name="agencyName" required maxLength={160} defaultValue={profile.agencyName} style={controlStyle} /></label>
      <label style={labelStyle}>Специализация<input name="specialization" maxLength={240} defaultValue={profile.specialization ?? ''} style={controlStyle} /></label>
      <label style={labelStyle}>География<input name="targetCity" maxLength={500} defaultValue={profile.targetCity ?? ''} style={controlStyle} /></label>
      <OptionChecks legend="Роли" name="roles" options={ROLE_OPTIONS} selected={profile.roles} />
      <OptionChecks legend="Отрасли" name="industries" options={INDUSTRY_OPTIONS} selected={profile.industries} />
      <OptionChecks legend="Размер компаний" name="companySizes" options={COMPANY_SIZE_OPTIONS} selected={profile.companySizes} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 8 }}>
        <NumberField name="dailyDigestLimit" label="Лимит дайджеста" value={profile.dailyDigestLimit} min={1} max={50} required />
        <NumberField name="hiringIntentMin" label="Мин. intent" value={profile.thresholds.hiringIntentMin} min={0} max={4} step={0.1} />
        <NumberField name="signalFreshnessDays" label="Свежесть, дней" value={profile.thresholds.signalFreshnessDays} min={1} max={365} />
        <NumberField name="minOpenRoles" label="Мин. вакансий" value={profile.thresholds.minOpenRoles} min={0} max={10000} />
      </div>
      <button disabled={pending} style={buttonStyle('#1d4ed8')}>{pending ? 'Сохраняем…' : 'Сохранить профиль'}</button>
      {state.message ? <Result state={state} /> : null}
    </form>
  </details>;
}

function OptionChecks({ legend, name, options, selected }: { legend: string; name: string; options: readonly { key: string; label: string }[]; selected: string[] }) {
  return <fieldset style={{ border: '1px solid #e2e8f0', borderRadius: 8 }}><legend>{legend}</legend><div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
    {options.map((option) => <label key={option.key} style={{ fontSize: '0.78rem' }}><input type="checkbox" name={name} value={option.key} defaultChecked={selected.includes(option.key)} /> {option.label}</label>)}
  </div></fieldset>;
}

function NumberField({ name, label, value, min, max, step, required }: { name: string; label: string; value: number | null; min: number; max: number; step?: number; required?: boolean }) {
  return <label style={labelStyle}>{label}<input type="number" name={name} min={min} max={max} step={step} required={required} defaultValue={value ?? ''} style={controlStyle} /></label>;
}

function ActionForm({ userId, workspaceId, action, label, danger = false }: { userId: string; workspaceId?: string | null; action: typeof adminPausePilot; label: string; danger?: boolean }) {
  const [state, formAction, pending] = useActionState(action, initial);
  return <form action={formAction} onSubmit={(event) => { if (danger && !window.confirm(`Подтвердите действие: ${label}`)) event.preventDefault(); }} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
    <input type="hidden" name="userId" value={userId} />
    {workspaceId ? <input type="hidden" name="workspaceId" value={workspaceId} /> : null}
    <button disabled={pending} style={buttonStyle(danger ? "#b42318" : "#475569")}>{pending ? "Выполняем…" : label}</button>
    {state.message ? <Result state={state} /> : null}
  </form>;
}

function Result({ state }: { state: State }) { return <span role="status" style={{ color: state.ok ? "#065f46" : "#b42318", fontSize: "0.8rem" }}>{state.message}</span>; }
const labelStyle = { display: "grid", gap: 4, fontSize: "0.78rem", color: "#475569" };
const controlStyle = { minHeight: 40, border: "1px solid #cbd5e1", borderRadius: 8, padding: "6px 8px", background: "#fff" };
const buttonStyle = (background: string) => ({ minHeight: 40, border: 0, borderRadius: 8, padding: "8px 12px", background, color: "#fff", fontWeight: 700, cursor: "pointer" });
