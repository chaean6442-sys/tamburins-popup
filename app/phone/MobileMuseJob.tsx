"use client";
import { useEffect, useRef, useState } from "react";

export type MusePhoneJob = {
  id: string;
  status: "waiting" | "image" | "model" | "complete" | "error";
  name: string;
  collection: string;
  objects: string[];
  effects: string[];
  strength: number;
  imageTaskId?: string;
  tripoTaskId?: string;
  arUrl?: string;
  error?: string;
};

const operatorOnlyFailure = (message: string) =>
  /크레딧|충전|credit|balance|billing|API\s*키|인증|권한|unauthorized|forbidden/i.test(message);

const visitorSafeJobError = (message: string) => operatorOnlyFailure(message)
  ? "현재 MUSE 제작을 잠시 진행할 수 없습니다. 현장 스태프에게 문의해주세요."
  : "MUSE 제작을 잠시 완료하지 못했습니다. 잠시 후 다시 시도해주세요.";

async function cropMuseTurnaroundSheet(sheet: string) {
  const source = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("4면도 이미지를 읽지 못했습니다."));
    image.src = sheet;
  });
  const halfWidth = Math.floor(source.naturalWidth / 2);
  const halfHeight = Math.floor(source.naturalHeight / 2);
  const crop = (column: number, row: number) => {
    const canvas = document.createElement("canvas");
    canvas.width = halfWidth;
    canvas.height = halfHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("4면도 이미지를 분리하지 못했습니다.");
    context.drawImage(source, column * halfWidth, row * halfHeight, halfWidth, halfHeight, 0, 0, halfWidth, halfHeight);
    return canvas.toDataURL("image/png");
  };
  return { front: crop(0, 0), left: crop(1, 0), back: crop(0, 1), right: crop(1, 1) };
}

export default function MobileMuseJob({ jobId }: { jobId: string }) {
  const [phase, setPhase] = useState("휴대폰으로 제작 정보를 옮기고 있어요");
  const [progress, setProgress] = useState(3);
  const [preview, setPreview] = useState("");
  const [arUrl, setArUrl] = useState("");
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const running = useRef(false);

  useEffect(() => {
    if (running.current) return;
    running.current = true;
    const readJson = async <T,>(response: Response): Promise<T> => {
      const raw = await response.text();
      try { return JSON.parse(raw) as T; } catch { throw new Error(`제작 서버 응답을 읽지 못했습니다. (${response.status})`); }
    };
    const updateJob = async (body: Omit<Partial<MusePhoneJob>, "imageTaskId" | "tripoTaskId"> & { imageTaskId?: string | null; tripoTaskId?: string | null }) => {
      const response = await fetch(`/api/muse-jobs/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error("휴대폰 제작 상태를 저장하지 못했습니다.");
    };
    const pollImage = async (taskId: string) => {
      for (let attempt = 0; attempt < 240; attempt += 1) {
        if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 2000));
        const response = await fetch(`/api/generate-world?taskId=${encodeURIComponent(taskId)}`);
        const data = await readJson<{ status?: string; image?: string; error?: string; code?: string; terminal?: boolean }>(response);
        if (!response.ok || data.error) {
          if (data.terminal || [400, 404].includes(response.status)) await updateJob({ imageTaskId: null });
          throw new Error(data.error ?? "이미지 생성 상태를 확인하지 못했습니다.");
        }
        setProgress(Math.min(45, 10 + Math.round(attempt / 8)));
        if (data.status === "completed" && data.image) return data.image;
      }
      throw new Error("이미지 생성 시간이 초과되었습니다. 다시 시도해주세요.");
    };
    const run = async () => {
      try {
        setError("");
        const jobResponse = await fetch(`/api/muse-jobs/${jobId}`);
        const jobData = await readJson<{ job?: MusePhoneJob; error?: string }>(jobResponse);
        if (!jobResponse.ok || !jobData.job) throw new Error(jobData.error ?? "제작 작업을 찾지 못했습니다.");
        const job = jobData.job;
        if (job.status === "complete" && job.arUrl) {
          const modelId = new URL(job.arUrl, window.location.href).searchParams.get("model");
          if (modelId) setPreview(`/api/ar-object/${modelId}`);
          setArUrl(job.arUrl);
          setProgress(100);
          setPhase("당신의 MUSE가 완성됐어요");
          return;
        }

        let tripoTaskId = job.tripoTaskId ?? "";
        if (!tripoTaskId) {
          setPhase("선택한 오브젝트로\nMUSE 이미지를 만들고 있어요");
          setProgress(8);
          await updateJob({ status: "image", error: "" });
          // A browser restart must continue the already paid image task.
          let imageTaskId = job.imageTaskId ?? "";
          let inlineSheet = "";
          if (!imageTaskId) {
            const response = await fetch("/api/generate-world", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ jobId }),
            });
            const created = await readJson<{ taskId?: string; image?: string; error?: string }>(response);
            if (!response.ok || created.error) throw new Error(created.error ?? "이미지 생성을 시작하지 못했습니다.");
            if (created.image) inlineSheet = created.image;
            else if (created.taskId) {
              imageTaskId = created.taskId;
            } else throw new Error("이미지 생성 작업을 시작하지 못했습니다.");
          }
          const views = await cropMuseTurnaroundSheet(inlineSheet || await pollImage(imageTaskId));
          setPreview(views.front);
          setProgress(50);
          setPhase("완성된 이미지를\n3D로 만들고 있어요");
          const response = await fetch("/api/tripo-model", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jobId, views, collection: job.collection, effects: job.effects, strength: job.strength }),
          });
          const created = await readJson<{ taskId?: string; error?: string }>(response);
          if (!response.ok || !created.taskId) throw new Error(created.error ?? "3D 생성을 시작하지 못했습니다.");
          tripoTaskId = created.taskId;
        } else {
          await updateJob({ status: "model", error: "" });
          setProgress(50);
          setPhase("완성된 이미지를\n3D로 만들고 있어요");
        }
        setPreview(`/api/tripo-preview/${encodeURIComponent(tripoTaskId)}`);

        let completedArUrl = "";
        for (let attempt = 0; attempt < 300; attempt += 1) {
          if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 2000));
          const response = await fetch(`/api/tripo-task/${encodeURIComponent(tripoTaskId)}`);
          const task = await readJson<{ status?: string; progress?: number; arUrl?: string; error?: string }>(response);
          if (["failed", "cancelled", "banned", "expired", "unknown"].includes(task.status ?? "")) {
            await updateJob({ tripoTaskId: null });
            throw new Error("3D 모델 생성에 실패했습니다.");
          }
          if (!response.ok || task.error) throw new Error(task.error ?? "3D 생성 상태를 확인하지 못했습니다.");
          setProgress(50 + Math.round((task.progress ?? 0) * .5));
          if (task.status === "success" && task.arUrl) { completedArUrl = task.arUrl; break; }
        }
        if (!completedArUrl) throw new Error("3D 모델 생성 시간이 초과되었습니다.");
        // Archive before marking the job complete. A failed save remains
        // retryable, and the job ID makes repeat requests idempotent.
        const archiveResponse = await fetch("/api/auras", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId, tripoTaskId, name: job.name, arUrl: completedArUrl, objects: job.objects }),
        });
        if (!archiveResponse.ok) throw new Error("완성된 MUSE를 저장하지 못했습니다. 다시 시도해주세요.");
        await updateJob({ status: "complete", arUrl: completedArUrl, error: "" });
        setArUrl(completedArUrl);
        setProgress(100);
        setPhase("당신의 MUSE가 완성됐어요");
      } catch (caught) {
        const operatorMessage = caught instanceof Error ? caught.message : "MUSE 제작에 실패했습니다.";
        setError(visitorSafeJobError(operatorMessage));
        setPhase("제작을 잠시 멈췄어요");
        await fetch(`/api/muse-jobs/${jobId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "error", error: operatorMessage }),
        }).catch(() => undefined);
      }
    };
    void run();
  }, [jobId, retryKey]);

  const retry = () => {
    running.current = false;
    setError("");
    setRetryKey((value) => value + 1);
  };
  const shareProgress = async () => {
    if (navigator.share) await navigator.share({ title: "Make Your MUSE", text: "내 MUSE 제작 페이지", url: window.location.href }).catch(() => undefined);
  };

  return (
    <main className="phone-job-shell">
      <header><span>Make Your MUSE</span><strong>TAMBURINS</strong></header>
      <section className="phone-job-card" aria-live="polite">
        {preview ? <img className="phone-job-preview" src={preview} alt="생성 중인 MUSE" /> : <div className="phone-job-orb" aria-hidden="true" />}
        <small>{progress}%</small>
        <h1>{phase}</h1>
        {!arUrl && !error && <><div className="phone-job-progress"><i style={{ width: `${progress}%` }} /></div><p>이 페이지를 켜둔 채 다른 곳에서 기다려도 됩니다.</p></>}
        {error && <>
          <p className="phone-job-error">{error}</p>
          <button type="button" onClick={retry}>다시 시도하기</button>
        </>}
        {arUrl && <>
          <button type="button" className="phone-job-primary" onClick={() => window.location.assign(arUrl)}>카메라로 3D 보기</button>
          {preview && <a className="phone-job-download" href={preview} download={`MUSE-${jobId.slice(0, 8)}.png`}>이미지로 저장하기</a>}
        </>}
        <a className="phone-job-archive" href={`/?archive=1&jobReturn=${jobId}`}>저장된 MUSE 보기</a>
        <button type="button" className="phone-job-share" onClick={() => void shareProgress()}>이 링크 보관하기</button>
      </section>
    </main>
  );
}

