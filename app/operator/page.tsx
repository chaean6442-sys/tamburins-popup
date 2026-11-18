"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type OperatorJob = {
  id: string;
  name: string;
  collection: string;
  objects: string[];
  status: "waiting" | "image" | "model" | "complete" | "error";
  error?: string;
  createdAt: number;
  updatedAt: number;
};

const STATUS_LABEL: Record<OperatorJob["status"], string> = {
  waiting: "휴대폰 연결 대기",
  image: "이미지 생성 중",
  model: "3D 생성 중",
  complete: "완성",
  error: "오류",
};

const OBJECT_IDS = [
  "flower", "leaf", "branch", "mushroom", "fruit", "fabric", "crystal", "feather", "ribbon", "lily", "rose",
] as const;
type ObjectModelStatus = "ready" | "processing" | "missing" | "error";
const TRIPO_WALLET = "https://platform.tripo3d.ai/billing";
const IMAGE_BILLING = "https://platform.openai.com/settings/organization/billing/overview";
function BillingLinks() {
  return <nav className="operator-billing-links" aria-label="충전 바로가기"><a href={TRIPO_WALLET} target="_blank" rel="noreferrer">Tripo API 충전 ↗</a><a href={IMAGE_BILLING} target="_blank" rel="noreferrer">이미지 API 충전 ↗</a></nav>;
}

const time = (value: number) => new Intl.DateTimeFormat("ko-KR", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
}).format(value);

export default function OperatorPage() {
  const [jobs, setJobs] = useState<OperatorJob[]>([]);
  const [accessKey, setAccessKey] = useState("");
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [checkedAt, setCheckedAt] = useState(0);
  const [newFailures, setNewFailures] = useState<OperatorJob[]>([]);
  const [objectModels, setObjectModels] = useState<Record<string, ObjectModelStatus>>({});
  const [preparingObjects, setPreparingObjects] = useState(false);
  const [objectError, setObjectError] = useState("");
  const seenFailures = useRef(new Set<string>());
  const initialLoad = useRef(true);
  const [notifications, setNotifications] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState("");
  const audio = useRef<AudioContext | null>(null);
  const alerted = useRef(new Set<string>());
  const [wallet, setWallet] = useState<{ balance: number; frozen: number; required: number; checkedAt: number } | null>(null);
  const [walletError, setWalletError] = useState("");
  const [walletLoading, setWalletLoading] = useState(false);
  const announce = useCallback((id: string, message: string) => {
    if (!notifications || alerted.current.has(id)) return;
    alerted.current.add(id);
    try {
      const context = audio.current;
      if (context) {
        void context.resume();
        const oscillator = context.createOscillator(); const gain = context.createGain();
        oscillator.connect(gain); gain.connect(context.destination); oscillator.frequency.value = 880;
        gain.gain.setValueAtTime(0.12, context.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.6);
        oscillator.start(); oscillator.stop(context.currentTime + 0.6);
      }
      if ("Notification" in window && Notification.permission === "granted") {
        const notice = new Notification("MUSE 운영 알림", { body: message, tag: id });
        notice.onclick = () => { window.focus(); notice.close(); };
      }
    } catch { /* In-page alerts remain available on unsupported browsers. */ }
  }, [notifications]);
  const enableNotifications = async () => {
    if (notifications) { setNotifications(false); return; }
    try { audio.current ??= new AudioContext(); await audio.current.resume(); } catch { /* Sound may be unsupported. */ }
    setNotifications(true);
    try {
      const permission = "Notification" in window ? await Notification.requestPermission() : "unsupported";
      setNotificationMessage(permission === "granted" ? "브라우저 알림과 알림음 켜짐" : "브라우저 알림을 사용할 수 없어 화면 알림과 지원되는 알림음으로 안내합니다.");
    } catch { setNotificationMessage("화면 알림과 지원되는 알림음으로 안내합니다."); }
  };
  const refreshWallet = useCallback(async () => {
    if (!accessKey) return;
    setWalletLoading(true);
    try {
      const response = await fetch("/api/operator/balance", { cache: "no-store", headers: { "X-Muse-Operator-Key": accessKey }, signal: AbortSignal.timeout(10000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "잔액을 확인하지 못했습니다.");
      setWallet(data); setWalletError("");
    } catch (caught) { setWalletError(caught instanceof Error ? caught.message : "잔액 연결을 확인해주세요."); }
    finally { setWalletLoading(false); }
  }, [accessKey]);
  useEffect(() => {
    if (!accessKey) return;
    void refreshWallet();
    const timer = window.setInterval(() => void refreshWallet(), 30000);
    const onFocus = () => void refreshWallet(); window.addEventListener("focus", onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [accessKey, refreshWallet]);
  useEffect(() => {
    jobs.filter((job) => job.status === "error").forEach((job) => announce(`job:${job.id}:${job.updatedAt}`, `${job.name || "GUEST"}: ${job.error || "제작 오류"}`));
    if (wallet && !walletError && wallet.balance < wallet.required) announce("balance-low", `Tripo API 크레딧 부족: ${wallet.balance} / 최소 ${wallet.required}. 관리자 페이지에서 충전해주세요.`);
    else if (wallet && !walletError) alerted.current.delete("balance-low");
    if (error) announce(`connection:${error}`, error);
    else [...alerted.current].filter((id) => id.startsWith("connection:")).forEach((id) => alerted.current.delete(id));
    if (objectError) announce(`object:${objectError}`, objectError);
    if (walletError) announce(`wallet:${walletError}`, walletError);
    else [...alerted.current].filter((id) => id.startsWith("wallet:")).forEach((id) => alerted.current.delete(id));
  }, [jobs, wallet, walletError, error, objectError, announce]);

  useEffect(() => {
    document.body.classList.add("operator-page-body");
    const key = new URLSearchParams(window.location.search).get("key") ?? "";
    setAccessKey(key);
    setReady(true);
    return () => document.body.classList.remove("operator-page-body");
  }, []);

  const refresh = useCallback(async () => {
    if (!accessKey) return;
    try {
      const response = await fetch("/api/operator/muse-jobs", {
        cache: "no-store",
        headers: { "X-Muse-Operator-Key": accessKey },
      });
      const data = await response.json() as { jobs?: OperatorJob[]; checkedAt?: number; error?: string };
      if (!response.ok) throw new Error(data.error ?? "상태를 불러오지 못했습니다.");
      const nextJobs = data.jobs ?? [];
      const failed = nextJobs.filter((job) => job.status === "error");
      if (!initialLoad.current) {
        const newlyFailed = failed.filter((job) => !seenFailures.current.has(job.id));
        if (newlyFailed.length) setNewFailures((current) => [...newlyFailed, ...current].slice(0, 8));
      }
      seenFailures.current = new Set(failed.map((job) => job.id));
      initialLoad.current = false;
      setJobs(nextJobs);
      setCheckedAt(data.checkedAt ?? Date.now());
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "상태를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [accessKey]);

  useEffect(() => {
    if (!ready || !accessKey) { if (ready) setLoading(false); return; }
    void refresh();
    const interval = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(interval);
  }, [accessKey, ready, refresh]);

  const counts = useMemo(() => ({
    active: jobs.filter((job) => job.status === "waiting" || job.status === "image" || job.status === "model").length,
    errors: jobs.filter((job) => job.status === "error").length,
    complete: jobs.filter((job) => job.status === "complete").length,
  }), [jobs]);

  const refreshObjectModels = useCallback(async () => {
    if (!accessKey) return;
    const entries = await Promise.all(OBJECT_IDS.map(async (id) => {
      try {
        const response = await fetch(`/api/object-models/${id}`, { cache: "no-store" });
        const data = await response.json() as { status?: ObjectModelStatus };
        return [id, data.status ?? "error"] as const;
      } catch {
        return [id, "error"] as const;
      }
    }));
    setObjectModels(Object.fromEntries(entries));
  }, [accessKey]);

  useEffect(() => {
    if (!ready || !accessKey) return;
    void refreshObjectModels();
    const interval = window.setInterval(() => void refreshObjectModels(), 10000);
    return () => window.clearInterval(interval);
  }, [accessKey, ready, refreshObjectModels]);

  const prepareObjectModels = useCallback(async () => {
    if (!accessKey || preparingObjects) return;
    setPreparingObjects(true);
    setObjectError("");
    try {
      for (const id of OBJECT_IDS) {
        const status = objectModels[id];
        if (status === "ready" || status === "processing") continue;
        const response = await fetch(`/api/object-models/${id}`, {
          method: "POST",
          headers: { "X-Muse-Operator-Key": accessKey },
        });
        const data = await response.json() as { error?: string };
        if (!response.ok) throw new Error(`${id}: ${data.error ?? "3D 생성을 시작하지 못했습니다."}`);
      }
      await refreshObjectModels();
    } catch (caught) {
      setObjectError(caught instanceof Error ? caught.message : "오브젝트 3D 준비를 시작하지 못했습니다.");
    } finally {
      setPreparingObjects(false);
    }
  }, [accessKey, objectModels, preparingObjects, refreshObjectModels]);

  const objectCounts = useMemo(() => ({
    ready: OBJECT_IDS.filter((id) => objectModels[id] === "ready").length,
    processing: OBJECT_IDS.filter((id) => objectModels[id] === "processing").length,
  }), [objectModels]);
  const readyObjectNames = useMemo(() => OBJECT_IDS.filter((id) => objectModels[id] === "ready").join(" · "), [objectModels]);
  const unavailableObjects = OBJECT_IDS.filter((id) => objectModels[id] === "missing" || objectModels[id] === "error");
  const unavailableSignature = unavailableObjects.join(",");
  useEffect(() => {
    if (unavailableSignature) announce(`missing:${unavailableSignature}`, `전시용 오브젝트 ${unavailableSignature.split(",").length}개가 누락되었거나 확인에 실패했습니다. 관리자 페이지에서 확인해주세요.`);
    else [...alerted.current].filter((id) => id.startsWith("missing:")).forEach((id) => alerted.current.delete(id));
  }, [unavailableSignature, announce]);

  if (!ready) return null;

  return <main className="operator-shell">
    <header className="operator-header">
      <div><small>TAMBURINS · PRIVATE</small><h1>MUSE 운영 상태</h1></div>
      <div className="operator-live"><i />5초마다 자동 확인</div>
    </header>

    {!accessKey ? <section className="operator-access-error">
      <strong>운영자 전용 주소가 아닙니다.</strong>
      <span>전달받은 운영자 링크로 접속해주세요.</span>
    </section> : <>
      <section className="operator-tools">
        <div><strong>오류 · 크레딧 부족 알림</strong><p>이 페이지를 열어두면 자동 확인합니다. 화면 잠금·브라우저 종료 시 알림이 중단될 수 있습니다.</p></div>
        <button type="button" onClick={() => void enableNotifications()}>{notifications ? "알림 끄기" : "알림 켜기"}</button>
        <span role="status">{notifications ? notificationMessage || "알림 활성화 중" : "화면 알림만 켜짐"}</span>
      </section>
      <section className={`operator-wallet ${wallet && !walletError && wallet.balance < wallet.required ? "has-error" : ""}`}>
        <div><small>Tripo API 지갑</small><strong>{walletError ? "잔액 확인 필요" : wallet ? `${wallet.balance.toLocaleString()} 크레딧` : "잔액 확인 중…"}</strong>
        <p>{walletError || (wallet ? `${wallet.balance < wallet.required ? "크레딧 부족 · " : ""}현재 3D 1회 요청 최소 ${wallet.required} 크레딧 · 보류 ${wallet.frozen}` : "30초마다 잔액 확인")}</p>
        {wallet && <small>마지막 확인 {time(wallet.checkedAt)}{walletError ? " · 이전 잔액입니다" : ""}</small>}</div>
        <BillingLinks /><button type="button" onClick={() => void refreshWallet()} disabled={walletLoading}>{walletLoading ? "확인 중" : "충전 후 잔액 확인"}</button>
        <p>Tripo는 API 지갑을 충전해주세요. 이미지 API 잔액은 충전 페이지에서 확인하며, 생성 중 발생한 부족 오류는 아래에 표시합니다.</p>
      </section>
      {newFailures.length > 0 && <section className="operator-new-alert" role="alert" aria-live="assertive">
        <div><small>새 오류</small><strong>{newFailures[0].name || "GUEST"} MUSE 제작이 멈췄습니다.</strong><span>{newFailures[0].error || "원인을 확인하지 못했습니다."}</span></div>
        <BillingLinks /><button type="button" onClick={() => setNewFailures([])}>확인</button>
      </section>}

      <section className="operator-summary" aria-label="생성 현황 요약">
        <article><span>진행 중</span><strong>{counts.active}</strong></article>
        <article className={counts.errors ? "has-error" : ""}><span>오류</span><strong>{counts.errors}</strong></article>
        <article><span>완료</span><strong>{counts.complete}</strong></article>
        <button type="button" onClick={() => void refresh()} disabled={loading}>{loading ? "확인 중" : "지금 새로고침"}</button>
      </section>

      <section className="operator-object-models" aria-label="오브젝트 3D 준비 상태">
        <div><small>표면 부착용 사전 제작 GLB</small><strong>{objectCounts.ready} / {OBJECT_IDS.length} 준비</strong><span>{objectCounts.processing ? `${objectCounts.processing}개 생성 중` : readyObjectNames || "준비된 모델 없음"}</span></div>
        <button type="button" onClick={() => void prepareObjectModels()} disabled={preparingObjects || objectCounts.ready === OBJECT_IDS.length}>{preparingObjects ? "생성 요청 중" : objectCounts.ready === OBJECT_IDS.length ? "모두 준비됨" : "누락 3D 생성"}</button>
      </section>
      {unavailableObjects.length > 0 && <p className="operator-fetch-error" role="alert">오브젝트 누락 또는 확인 실패 {unavailableObjects.length}개: {unavailableObjects.join(" · ")}. 연결 상태를 확인하고 필요한 3D를 준비해주세요.</p>}
      {objectError && <p className="operator-fetch-error" role="alert">{objectError}</p>}

      {error && <p className="operator-fetch-error" role="alert">{error}</p>}

      <section className="operator-feed">
        <div className="operator-feed-title"><h2>최근 제작 작업</h2><span>{checkedAt ? `${time(checkedAt)} 확인` : "연결 중"}</span></div>
        {jobs.length === 0 && !loading ? <div className="operator-empty">아직 제작 작업이 없습니다.</div> : jobs.map((job) => <article key={job.id} className={`operator-job is-${job.status}`}>
          <div className="operator-job-status"><i /><span>{STATUS_LABEL[job.status]}</span></div>
          <div className="operator-job-main">
            <strong>{job.name || "GUEST"}</strong>
            <span>{job.collection}</span>
            {job.objects.length > 0 && <small>{job.objects.join(" · ")}</small>}
            {job.status === "error" && <p>{job.error || "원인을 확인하지 못했습니다."}</p>}
            {job.status === "error" && <BillingLinks />}
          </div>
          <time>{time(job.updatedAt)}</time>
        </article>)}
      </section>
    </>}
  </main>;
}
