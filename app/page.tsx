import Experience from "./Experience";
import MobileMuseJob from "./phone/MobileMuseJob";

export default async function Home({ searchParams }: { searchParams: Promise<{ job?: string | string[] }> }) {
  const { job } = await searchParams;
  // Keep the waiting phone outside the kiosk's Three.js, camera and GLB
  // bundles. Safari was restarting its tab while these loaded in parallel.
  if (typeof job === "string" && /^[a-f0-9]{32}$/.test(job)) {
    return <MobileMuseJob jobId={job} />;
  }
  return <Experience />;
}
