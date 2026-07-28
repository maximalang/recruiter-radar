import type { Metadata } from "next";
import Link from "next/link";

import { readPendingAccountLogin } from "@/lib/account-login-cookie";
import { readLoginChallengePreview } from "@/lib/account-auth";
import { readAuthV2LoginChallengePreview } from "@/lib/auth-v2/challenges";
import { isAuthPlatformV2EnabledForUser } from "@/lib/auth-v2/config";
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
  let target: { maskedEmail: string; userId: string | null } | null = null;
  if (token) {
    const v2Preview = await readAuthV2LoginChallengePreview(token)
      .catch(() => null);
    if (
      v2Preview
      && isAuthPlatformV2EnabledForUser(v2Preview.userId)
    ) {
      target = v2Preview;
    } else {
      target = await readLoginChallengePreview(token).catch(() => null);
    }
  }
  const active = target !== null;
  const currentOwnerId = await readOwnerSession();
  const replacingAnotherAccount = Boolean(
    currentOwnerId
    && target?.userId
    && currentOwnerId !== target.userId,
  );

  return (
    <main className={loginStyles.shell}>
      <section className={loginStyles.card}>
        <Link href="/" className={loginStyles.brand}><BrandLogo size="small" /></Link>
        <p className={loginStyles.eyebrow}>Защищённый вход</p>
        <h1 className={loginStyles.title}>{active ? "Подтвердите вход" : "Ссылка больше не действует"}</h1>
        <p className={loginStyles.lead}>
          {target
            ? replacingAnotherAccount
              ? `Текущий аккаунт будет заменён. Продолжить как ${target.maskedEmail}?`
              : `Продолжить как ${target.maskedEmail}?`
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
