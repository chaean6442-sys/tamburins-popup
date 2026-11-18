"use client";

import { useEffect, useState } from "react";

type WebkitFullscreenDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type WebkitFullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

export default function FullscreenControl() {
  const [active, setActive] = useState(false);
  const [supported, setSupported] = useState(false);
  const [message, setMessage] = useState("");

  const enter = async () => {
    try {
      if (!document.fullscreenElement) {
        if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
        else await (document.documentElement as WebkitFullscreenElement).webkitRequestFullscreen?.();
      }
      setMessage("");
    } catch {
      setMessage("전체화면 버튼을 다시 눌러주세요.");
    }
  };

  useEffect(() => {
    const webkitDocument = document as WebkitFullscreenDocument;
    const webkitElement = document.documentElement as WebkitFullscreenElement;
    setSupported(Boolean(
      (document.fullscreenEnabled && document.documentElement.requestFullscreen) ||
      (webkitDocument.webkitFullscreenEnabled && webkitElement.webkitRequestFullscreen),
    ));
    const sync = () => setActive(Boolean(document.fullscreenElement || webkitDocument.webkitFullscreenElement));
    sync();
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);

    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, []);

  if (!supported) return null;

  return <div className="fullscreen-control">
    <button type="button" title={active ? "전체화면 종료 (Esc)" : "전체화면"} aria-label={active ? "전체화면 종료" : "전체화면"} aria-pressed={active} onClick={async () => {
      if (active) {
        try {
          if (document.exitFullscreen) await document.exitFullscreen();
          else await (document as WebkitFullscreenDocument).webkitExitFullscreen?.();
        } catch { setMessage("브라우저 메뉴에서 전체화면을 종료할 수 있습니다."); }
      } else await enter();
    }}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d={active ? "M9 3v6H3m12-6v6h6M3 15h6v6m12-6h-6v6" : "M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"} /></svg></button>
    {message && <span role="status">{message}</span>}
  </div>;
}
