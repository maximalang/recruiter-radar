import type { Metadata } from "next";
import Link from "next/link";

import { getAccountById, sanitizeAccountReturnTo } from "@/lib/account-auth";
import { readOwnerSession } from "@/lib/session";
import { BrandLogo } from "../ui/brand-logo";
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
    <main className={styles.shell}>
      <section className={styles.card}>
        <Link href="/" className={styles.brand}><BrandLogo size="small" /></Link>
        <p className={styles.eyebrow}>Личный кабинет</p>
        <h1 className={styles.title}>Войти без пароля</h1>
        <p className={styles.lead}>Получите одноразовую ссылку на рабочую почту. Она одновременно подтверждает адрес и защищает данные кабинета.</p>
        {account ? <p className={styles.notice}>Сейчас вы вошли как {account.email}. Можно продолжить или указать другой email, чтобы явно сменить аккаунт.</p> : null}
        {query.error ? <p className={styles.error}>Ссылка недействительна или уже использована. Запросите новую.</p> : null}
        {query.loggedOut ? <p className={styles.success}>Вы вышли из аккаунта.</p> : null}
        <LoginForm returnTo={returnTo} initialEmail={query.email} />
        {account ? <Link className={styles.back} href={returnTo}>Продолжить в кабинете →</Link> : <Link className={styles.back} href="/">← На главную</Link>}
      </section>
    </main>
  );
}
