import type { Metadata } from "next";
import Link from "next/link";

import { readPendingAccountLogin } from "@/lib/account-login-cookie";
import {
  getAccountById,
  readLoginChallengeState,
} from "@/lib/account-auth";
import { readAuthV2LoginChallengeState } from "@/lib/auth-v2/challenges";
import { isAuthPlatformV2EnabledForUser } from "@/lib/auth-v2/config";
import { readOwnerSession } from "@/lib/session";
import { AuthShell } from "../../login/auth-shell";
import loginStyles from "../../login/login.module.css";
import {
  cancelAccountLoginAction,
  confirmAccountLoginAction,
} from "./actions";

export const metadata: Metadata = {
  title: "Подтверждение входа — Recruiter Radar",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export const dynamic = "force-dynamic";

type ConfirmChallengeState =
  | {
    status: "active";
    maskedEmail: string;
    userId: string | null;
  }
  | {
    status: "expired" | "used" | "invalid";
    userId: string | null;
  };

const INACTIVE_COPY = {
  expired: {
    eyebrow: "Срок действия истёк",
    title: "Срок действия ссылки истёк",
    lead: "Одноразовая ссылка действует 15 минут. Запросите новую — предыдущая останется недействительной.",
  },
  used: {
    eyebrow: "Ссылка закрыта",
    title: "Эта ссылка уже использована",
    lead: "Одноразовая ссылка срабатывает только один раз. Если вход не завершён, запросите новое письмо.",
  },
  invalid: {
    eyebrow: "Ссылка повреждена",
    title: "Не удалось прочитать ссылку",
    lead: "Адрес мог быть скопирован не полностью или не относится к Recruiter Radar. Запросите новую безопасную ссылку.",
  },
} as const;

export default async function ConfirmAccountLoginPage() {
  const token = await readPendingAccountLogin();
  const challenge = token
    ? await resolveChallengeState(token)
    : {
      status: "invalid",
      userId: null,
    } satisfies ConfirmChallengeState;

  const currentOwnerId = await readOwnerSession();
  const currentAccount = await getAccountById(currentOwnerId).catch(() => null);
  const active = challenge.status === "active";
  const replacingAnotherAccount = Boolean(
    active
    && currentOwnerId
    && challenge.userId
    && currentOwnerId !== challenge.userId
  );

  if (!active) {
    const copy = INACTIVE_COPY[challenge.status];
    return (
      <AuthShell>
        <p className={loginStyles.eyebrow}>{copy.eyebrow}</p>
        <h1 className={loginStyles.title}>{copy.title}</h1>
        <p className={loginStyles.lead}>{copy.lead}</p>
        <Link className={loginStyles.submit} href="/login">
          Получить новую ссылку
        </Link>
        <Link className={loginStyles.back} href="/">
          ← На главную
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <p className={loginStyles.eyebrow}>Подтверждение входа</p>
      <h1 className={loginStyles.title}>
        Продолжить как {challenge.maskedEmail}?
      </h1>
      <p className={loginStyles.lead}>
        Аккаунт изменится только после нажатия кнопки. Открытие письма само по
        себе не создаёт сессию.
      </p>
      {replacingAnotherAccount && currentAccount ? (
        <div className={loginStyles.securityNotice} role="note">
          <strong>Сейчас вы вошли как {currentAccount.email}.</strong>
          <span>
            Продолжение завершит текущую сессию в этом браузере и заменит её
            аккаунтом {challenge.maskedEmail}.
          </span>
        </div>
      ) : currentAccount ? (
        <p className={loginStyles.notice}>
          Сейчас вы вошли как <strong>{currentAccount.email}</strong>.
          Подтверждение безопасно обновит текущую сессию.
        </p>
      ) : null}
      <div className={loginStyles.confirmActions}>
        <form action={confirmAccountLoginAction}>
          <button className={loginStyles.submit} type="submit">
            Продолжить
          </button>
        </form>
        <form action={cancelAccountLoginAction}>
          <button className={loginStyles.secondaryAction} type="submit">
            Отменить
          </button>
        </form>
      </div>
      <p className={loginStyles.helper}>
        Если вы не запрашивали вход, нажмите «Отменить» и не пересылайте ссылку.
      </p>
    </AuthShell>
  );
}

async function resolveChallengeState(
  token: string,
): Promise<ConfirmChallengeState> {
  const v2State = await readAuthV2LoginChallengeState(token)
    .catch(() => ({ status: "invalid" as const, userId: null }));
  if (
    v2State.status !== "invalid"
    && isAuthPlatformV2EnabledForUser(v2State.userId)
  ) {
    return v2State;
  }
  return readLoginChallengeState(token)
    .catch(() => ({ status: "invalid" as const, userId: null }));
}
