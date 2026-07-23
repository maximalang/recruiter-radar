import YandexMetrika from "@/app/yandex-metrika";

describe("YandexMetrika", () => {
  const originalId = process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID;

  afterEach(() => {
    if (originalId === undefined) delete process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID;
    else process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID = originalId;
  });

  it("renders nothing when the public counter id is missing or invalid", () => {
    delete process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID;
    expect(YandexMetrika()).toBeNull();

    process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID = "not-a-counter";
    expect(YandexMetrika()).toBeNull();
  });

  it("loads the official tag only for a numeric counter id", () => {
    process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID = "12345678";
    const script = YandexMetrika();
    const initialization = script?.props.children as string;

    expect(initialization).toContain("https://mc.yandex.ru/metrika/tag.js");
    expect(initialization).toContain("12345678");
  });
});
