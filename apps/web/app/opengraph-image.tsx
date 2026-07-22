import { ImageResponse } from "next/og";

export const alt = "Recruiter Radar — компании, которым стоит написать сегодня";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          padding: "58px 64px",
          color: "#f7faff",
          background: "linear-gradient(135deg, #07101f 0%, #0b1730 58%, #10264c 100%)",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <div style={{ display: "flex", width: "57%", flexDirection: "column", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", fontSize: 31, fontWeight: 700 }}>
            <svg width={58} height={58} viewBox="0 0 1254 1254" aria-hidden="true" style={{ borderRadius: 14 }}>
              <rect width="1254" height="1254" fill="#eee7e1" />
              <path
                d="M516.3 257.4A387 410 0 1 1 241.9 609.3"
                fill="none"
                stroke="#725844"
                strokeWidth="78"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M537.1 475.5A192 204 0 1 1 439.8 604.7"
                fill="none"
                stroke="#4d3627"
                strokeWidth="74"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                fill="#285f85"
                fillRule="evenodd"
                clipRule="evenodd"
                d="M266 272H407C456 272 495 314 495 365C495 402 477 436 447 458L602 612L627 654L579 639L334 464H318C316 464 315 465 315 467V518C315 534 302 547 286 547H269C252 547 239 533 239 516V301C239 285 251 272 266 272ZM315 345C315 343 317 341 320 341H397C414 341 427 355 427 373C427 391 414 405 397 405H318C316 405 315 403 315 401Z"
              />
              <circle cx="627" cy="654" r="50" fill="#285f85" />
            </svg>
            <span style={{ display: "flex", marginLeft: 16 }}>
              <span>Recruiter</span>
              <span style={{ color: "#6da8ff" }}>Radar</span>
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", color: "#7fb0ff", fontSize: 20, letterSpacing: 2, textTransform: "uppercase" }}>Private intelligence desk</div>
            <div style={{ display: "flex", marginTop: 20, fontSize: 54, fontWeight: 750, lineHeight: 1.06, letterSpacing: -2 }}>
              Компании, которым стоит написать сегодня
            </div>
            <div style={{ display: "flex", marginTop: 24, color: "#bdcbe0", fontSize: 23, lineHeight: 1.35 }}>
              Сигналы найма · доказательства · уровень доверия · следующий шаг
            </div>
          </div>
          <div style={{ display: "flex", color: "#8fa3bf", fontSize: 18 }}>Ежедневный радар для рекрутинговых агентств</div>
        </div>

        <div style={{ display: "flex", width: "43%", alignItems: "center", justifyContent: "flex-end" }}>
          <div style={{ width: 430, display: "flex", flexDirection: "column", padding: "28px", border: "1px solid #29446d", borderRadius: 22, background: "#0c1a31" }}>
            <div style={{ display: "flex", justifyContent: "space-between", color: "#8fa3bf", fontSize: 16 }}><span>ОБЕЗЛИЧЕННЫЙ ЛИД</span><span>GATE A</span></div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 28 }}>
              <div style={{ display: "flex", width: "72%", flexDirection: "column" }}><strong style={{ fontSize: 27 }}>Производственная компания</strong><span style={{ marginTop: 8, color: "#8fa3bf", fontSize: 17 }}>Москва · промышленность</span></div>
              <strong style={{ display: "flex", flexShrink: 0, marginLeft: 16, color: "#73a8ff", fontSize: 46 }}>87</strong>
            </div>
            <div style={{ display: "flex", height: 7, marginTop: 22, borderRadius: 8, background: "#183052" }}><div style={{ display: "flex", width: "87%", height: "100%", borderRadius: 8, background: "#4e8eff" }} /></div>
            <div style={{ display: "flex", marginTop: 28, padding: "18px 0", borderTop: "1px solid #223b60", borderBottom: "1px solid #223b60", color: "#d5dfed", fontSize: 18 }}>14 новых вакансий за 6 дней</div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 22, color: "#9db1ca", fontSize: 15 }}><span>FIT 88</span><span>INTENT 84</span><span>URGENCY 94</span><span>REACH 82</span></div>
            <div style={{ display: "flex", marginTop: 25, color: "#d7a85d", fontSize: 17 }}>Следующий шаг → проверить HR-форму</div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
