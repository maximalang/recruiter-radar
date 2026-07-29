import type { Metadata } from "next";
import Link from "next/link";

import { getAccountById, sanitizeAccountReturnTo } from "@/lib/account-auth";
import { isAuthPasskeyLoginAvailable } from "@/lib/auth-v2/config";
import { readOwnerSession } from "@/lib/session";
import { AuthShell } from "./auth-shell";
import LoginForm from "./login-form";
import styles from "./login.module.css";

export const metadata: Metadata = {
  title: "Вход — Recruiter Radar",
  description: "Безопасный вход в личный кабинет Recruiter Radar по одноразовой ссылке.",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function LoginPage(props: {
  searchParams: Promise<{ returnTo?: string; email?: string; error?: string; loggedOut?: string }>;
}) {
  const query = await props.searchParams;
  const returnTo = sanitizeAccountReturnTo(query.returnTo);
  const account = await getAccountById(await readOwnerSession()).catch(() => null);

  return (
    <AuthShell>
      <p className={styles.eyebrow}>Личный кабинет</p>
      <h1 className={styles.title}>Войти в Recruiter Radar</h1>
      <p className={styles.lead}>
        Введите рабочий email. Если аккаунта ещё нет, мы создадим его после
        подтверждения адреса.
      </p>
      {account ? (
        <p className={styles.notice}>
          Сейчас вы вошли как <strong>{account.email}</strong>. Можно продолжить
          или указать другой email, чтобы явно сменить аккаунт.
        </p>
      ) : null}
      {query.error ? (
        <p className={styles.error} role="alert">
          Ссылка недействительна или уже использована. Запросите новую.
        </p>
      ) : null}
      {query.loggedOut ? (
        <p className={styles.success} role="status">Вы вышли из аккаунта.</p>
      ) : null}
      <LoginForm
        returnTo={returnTo}
        initialEmail={query.email}
        passkeysAvailable={isAuthPasskeyLoginAvailable()}
      />
      {account ? (
        <Link className={styles.back} href={returnTo}>
          Продолжить в кабинете →
        </Link>
      ) : (
        <Link className={styles.back} href="/">← На главную</Link>
      )}
    </AuthShell>
  );
}
