import styles from "./story.module.css";

/** Original, text-free editorial art. These are diagrams, never live product evidence. */
export function EvidenceConstellation() {
  return (
    <svg className={styles.constellation} viewBox="0 0 640 480" aria-hidden="true" focusable="false">
      <ellipse cx="332" cy="424" rx="237" ry="24" fill="#D7DBD1" opacity=".5" />
      <g fill="none" stroke="#BCCBC2" strokeWidth="1">
        <ellipse cx="330" cy="246" rx="265" ry="166" />
        <ellipse cx="330" cy="246" rx="207" ry="129" />
        <path d="M65 246h530M330 80v332" strokeDasharray="3 9" />
      </g>
      <g stroke="#2F7467" strokeWidth="2" fill="none">
        <path d="M175 192C242 192 229 286 310 286M454 142C393 142 410 286 350 286M478 354C415 354 413 300 350 300" />
      </g>
      <g transform="translate(92 98)">
        <path d="M9 78 66 43 132 80 75 115Z" fill="#CBD8D0" />
        <path d="M16 67V0l56-27 0 105Z" fill="#F8F6F0" stroke="#BCCBC2" />
        <path d="M72-27 125 4v96L72 78Z" fill="#D6E4DD" stroke="#BCCBC2" />
        <path d="M16 0 72-27 125 4 68 30Z" fill="#FFFDF8" stroke="#BCCBC2" />
        {[0, 1, 2].map((row) => [0, 1, 2].map((column) => (
          <path key={`${row}-${column}`} d={`M${26 + column * 14} ${15 + row * 20 - column * 7}v10l7-3v-10Z`} fill="#2F7467" opacity=".7" />
        )))}
        <path d="M88 26v46m15-37v46" stroke="#8FA99C" strokeWidth="6" />
      </g>
      <g transform="translate(396 65) rotate(9 64 64)">
        <rect x="8" y="10" width="122" height="153" rx="7" fill="#CCD7CE" />
        <path d="M0 0h85l35 35v118H0Z" fill="#F8F6F0" stroke="#A8BDB1" />
        <path d="M85 0v35h35" fill="#E4EFEB" stroke="#A8BDB1" />
        <circle cx="35" cy="68" r="18" fill="#E4EFEB" />
        <path d="m26 68 6 6 13-14" fill="none" stroke="#2F7467" strokeWidth="3" />
        <path d="M23 111h72" stroke="#D0D9D1" strokeWidth="2" />
      </g>
      <g transform="translate(220 226)">
        <path d="M4 10h193v143H4Z" fill="#C4D2C8" />
        <path d="M0 0h65l17 19h115v124H0Z" fill="#2F7467" />
        <path d="M11 29h175v94H11Z" fill="#DDEAE2" />
        <path d="M22 17h153v102H22Z" fill="#F8F6F0" stroke="#A8BDB1" />
        <path d="M0 48h197l-15 95H14Z" fill="#E4EFEB" stroke="#8FA99C" />
        <circle cx="99" cy="94" r="21" fill="#2F7467" />
        <path d="m90 94 6 6 15-15" fill="none" stroke="#F8F6F0" strokeWidth="3" />
      </g>
      <g transform="translate(452 316) rotate(-9 54 54)">
        <rect x="7" y="8" width="99" height="105" rx="5" fill="#CBD8D0" />
        <rect width="99" height="105" rx="5" fill="#F8F6F0" stroke="#A8BDB1" />
        <circle cx="49" cy="45" r="23" fill="none" stroke="#2F7467" strokeWidth="2" />
        <path d="M49 31v14l10 6" fill="none" stroke="#2F7467" strokeWidth="2" />
      </g>
      {[[175, 192], [454, 142], [478, 354]].map(([cx, cy]) => <circle key={cx} cx={cx} cy={cy} r="5" fill="#2F7467" stroke="#F8F6F0" strokeWidth="3" />)}
    </svg>
  );
}

export function PaperArt({ variant }: { variant: "signal" | "context" | "assembled" | "priority" | "contact" }) {
  return (
    <svg className={styles.paperArt} viewBox="0 0 400 270" aria-hidden="true" focusable="false">
      <ellipse cx="207" cy="238" rx="152" ry="16" fill="#CDD6CC" opacity=".5" />
      {variant === "contact" ? (
        <>
          <path d="m83 39 227 8-14 178-229-8Z" fill="#DDDCD2" />
          <path d="m76 29 227 8-14 178-229-8Z" fill="#F8F6F0" stroke="#B7C9BC" />
          <path d="M77 53 293 61M74 72l216 8" stroke="#D7DED4" />
          <path d="m327 65-40 132-12 13-2-19 39-131Z" fill="#14201C" />
          <path d="m313 61 14 4-7 22-14-4Z" fill="#2F7467" />
          <path d="m275 191 12 6-12 13Z" fill="#8E5D42" />
          <path d="M123 164c16-39 60-64 112-61" fill="none" stroke="#A3BFAE" strokeWidth="2" strokeDasharray="4 6" />
        </>
      ) : variant === "priority" ? (
        <>
          {[0, 1, 2].map((i) => (
            <g key={i} transform={`translate(${58 + i * 24} ${27 + i * 62})`}>
              <rect x="7" y="7" width="240" height="51" rx="5" fill="#CBD8D0" />
              <rect width="240" height="51" rx="5" fill={i === 0 ? "#E4EFEB" : "#F8F6F0"} stroke="#A8BDB1" />
              <rect x="0" y="0" width="5" height="51" rx="2" fill={i === 0 ? "#2F7467" : "#A8BDB1"} />
              <circle cx="29" cy="25" r="10" fill="none" stroke="#2F7467" />
            </g>
          ))}
          <path d="M34 32v171m-6-7 6 7 6-7" fill="none" stroke="#2F7467" strokeWidth="2" />
        </>
      ) : (
        <>
          {variant !== "signal" && <path d="M78 96C181 26 288 83 310 164" fill="none" stroke="#2F7467" strokeWidth="2" />}
          {(variant === "signal" ? [1] : [0, 1, 2]).map((i) => (
            <g key={i} transform={`translate(${40 + i * 93} ${56 + (i % 2) * 32}) rotate(${(i - 1) * 8} 52 64)`}>
              <rect x="6" y="8" width="104" height="128" rx="5" fill="#CAD7CD" />
              <rect width="104" height="128" rx="5" fill={i === 1 ? "#E4EFEB" : "#F8F6F0"} stroke="#A8BDB1" />
              <circle cx="52" cy="61" r="24" fill="none" stroke="#2F7467" strokeWidth="2" />
              <path d="m42 61 7 7 15-17" fill="none" stroke="#2F7467" strokeWidth="2" />
            </g>
          ))}
          {variant === "assembled" && <path d="M87 168h235l-17 59H101Z" fill="#2F7467" stroke="#245B51" />}
        </>
      )}
    </svg>
  );
}

export function FieldMark({ index }: { index: number }) {
  const paths = ["M16 40h32M20 29h24M24 18h16", "M13 19h38v24H32l-10 7v-7h-9Z", "M14 14h24l12 12v24H14ZM38 14v12h12", "M14 20h36M14 32h27M14 44h18", "M13 32h37m-12-12 12 12-12 12"];
  return <svg viewBox="0 0 64 64" className={styles.fieldMark} aria-hidden="true" focusable="false"><path d={paths[index]} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
