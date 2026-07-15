import type { Metadata } from "next";
import Link from "next/link";

import { readPendingAccountLogin } from "@/lib/account-login-cookie";
import { isLoginChallengeActive } from "@/lib/account-auth";
import { readOwnerSession } from "@/lib/session";
import { BrandLogo } from "../../ui/brand-logo";
import loginStyles from "../../login/login.module.css";
import { confirmAccountLoginAction } from "./actions";

export const metadata: Metadata = {
  title: "Подтверждение входа — Recruiter Radar",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export const dynamic = "force-dynamic";

export default async function ConfirmAccountLoginPage() {
  const token = await readPendingAccountLogin();
  const active = token ? await isLoginChallengeActive(token).catch(() => false) : false;
  const currentOwnerId = await readOwnerSession();

  return (
    <main className={loginStyles.shell}>
      <section className={loginStyles.card}>
        <Link href="/" className={loginStyles.brand}><BrandLogo size="small" /></Link>
        <p className={loginStyles.eyebrow}>Защищённый вход</p>
        <h1 className={loginStyles.title}>{active ? "Подтвердите вход" : "Ссылка больше не действует"}</h1>
        <p className={loginStyles.lead}>
          {active
            ? currentOwnerId
              ? "После подтверждения текущий аккаунт будет явно заменён аккаунтом из письма."
              : "Последний шаг: подтвердите вход на этом устройстве."
            : "Одноразовая ссылка истекла или уже была использована. Запросите новую — это займёт меньше минуты."}
        </p>
        {active ? (
          <form action={confirmAccountLoginAction}>
            <button className={loginStyles.submit} type="submit">Подтвердить и войти</button>
          </form>
        ) : (
          <Link className={loginStyles.back} href="/login">Получить новую ссылку →</Link>
        )}
      </section>
    </main>
  );
}
