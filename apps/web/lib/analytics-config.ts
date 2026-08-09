export function getYandexMetrikaCounterId(): string | null {
  const value = process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID?.trim() ?? "";
  return /^\d{5,12}$/.test(value) ? value : null;
}

export function isYandexMetrikaConfigured(): boolean {
  return getYandexMetrikaCounterId() !== null;
}
