import Link from "next/link";

import { buildCheckoutHref, readPublicPreviewInput } from "../../lib/publicProduct";

export default function CheckoutPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const input = readPublicPreviewInput(searchParams);
  const restartHref = buildCheckoutHref(input);

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", padding: "0 16px", fontFamily: "Inter, sans-serif" }}>
      <h1>Checkout</h1>
      <p>Страница чекаута активна. Следующий шаг — запуск оплаты через API/форму onboarding.</p>
      <p><Link href={restartHref}>Обновить параметры пилота</Link></p>
    </main>
  );
}
