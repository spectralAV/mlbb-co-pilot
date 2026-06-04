import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BarChart3, Clock3, Film, Play, RefreshCw } from "lucide-react";
import {
  getVideoCvFootage,
  getVideoCvReview,
  listVideoCvReviews,
  runVideoCvReview,
} from "../api/client";

type FootageEntry = {
  name: string;
  manifestPath: string;
  extractedFrames: number;
  fps: number;
  width: number;
  height: number;
  video: string;
  createdAt: string;
};

type ReviewSummary = {
  id: string;
  footageName: string;
  createdAt: string;
  sampledFrames: number;
  dominantScreen: string;
  draftEvents: number;
  reports: { json: string; markdown: string; html: string };
};

type ReviewSegment = {
  screen: string;
  startSeconds: number;
  endSeconds: number;
  meanConfidence: number;
  sampleCount: number;
};

type ReviewDetail = ReviewSummary & {
  segments: ReviewSegment[];
  draftEvents: Array<{ type: string; timestampSeconds: number; confidence: number }>;
  summary: {
    draftSeconds: number;
    liveHudSeconds: number;
    dominantScreen: string;
  };
  coachIntegration: {
    reasoningEvents?: string;
    links: { draftRoom: string; gameAnalysis: string; cvStudioVideo: string };
  };
  reports?: { replayEvents?: string };
  replayEvents?: Array<{ ruleId: string; callout: string; screen: string; timestampSeconds: number | null }>;
};

function formatTime(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function VideoCvReviewPage() {
  const [footage, setFootage] = useState<FootageEntry[]>([]);
  const [reviews, setReviews] = useState<ReviewSummary[]>([]);
  const [selectedFootage, setSelectedFootage] = useState("");
  const [selectedReviewId, setSelectedReviewId] = useState("");
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [interval, setInterval] = useState(1);
  const [maxFrames, setMaxFrames] = useState(120);
  const [runYolo, setRunYolo] = useState(false);
  const [replayCoach, setReplayCoach] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("Select extracted footage or an existing review.");

  const refresh = useCallback(async () => {
    const [footageResponse, reviewsResponse] = await Promise.all([
      getVideoCvFootage(),
      listVideoCvReviews(),
    ]);
    const footageList = (footageResponse.data ?? []) as FootageEntry[];
    const reviewList = (reviewsResponse.data ?? []) as ReviewSummary[];
    setFootage(footageList);
    setReviews(reviewList);
    if (!selectedFootage && footageList[0]?.name) setSelectedFootage(footageList[0].name);
    if (!selectedReviewId && reviewList[0]?.id) setSelectedReviewId(reviewList[0].id);
  }, [selectedFootage, selectedReviewId]);

  useEffect(() => {
    void refresh().catch((error) => setMessage(error instanceof Error ? error.message : "Failed to load footage."));
  }, [refresh]);

  useEffect(() => {
    if (!selectedReviewId) {
      setDetail(null);
      return;
    }
    void getVideoCvReview(selectedReviewId)
      .then((response) => setDetail(response.data ?? null))
      .catch((error) => setMessage(error instanceof Error ? error.message : "Failed to load review."));
  }, [selectedReviewId]);

  const selectedFootageEntry = useMemo(
    () => footage.find((entry) => entry.name === selectedFootage) ?? null,
    [footage, selectedFootage],
  );

  async function handleRunReview() {
    if (!selectedFootage) return;
    setBusy("review");
    setMessage(`Running CV review on ${selectedFootage}…`);
    try {
      const response = await runVideoCvReview({
        footage: selectedFootage,
        sampleIntervalSeconds: interval,
        maxFrames,
        runYolo,
        replayCoach,
      });
      const review = response.data;
      const replayNote = replayCoach ? " Offline coach replay included." : "";
      setMessage(`Review ${review.id} complete (${review.sampledFrames} frames).${replayNote}`);
      setSelectedReviewId(review.id);
      await refresh();
      if (replayCoach) {
        const detailResponse = await getVideoCvReview(review.id);
        setDetail(detailResponse.data ?? null);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Review failed.");
    } finally {
      setBusy("");
    }
  }

  return <div className="cv-page space-y-6">
    <header className="cv-hero">
      <div className="min-w-0">
        <div className="mb-5 flex items-center gap-3 text-xs font-bold uppercase text-slate-500">
          <span>CV Studio</span>
          <span>/</span>
          <span className="text-cyan-300">Batch Review</span>
        </div>
        <h2>Video CV Review</h2>
        <p className="mt-4 max-w-3xl text-base text-slate-400">
          Run offline screen-state timeline analysis over extracted footage manifests. For frame-by-frame annotation, use{" "}
          <Link to="/cv-studio/video" className="text-cyan-300 underline">Video Review</Link>.
        </p>
      </div>
    </header>

    <div className="grid gap-4 xl:grid-cols-2">
      <section className="cv-panel">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-lg font-bold text-white"><Film size={18} /> Extracted Footage</h3>
          <button type="button" className="cv-icon-button" onClick={() => void refresh()} aria-label="Refresh footage list">
            <RefreshCw size={16} />
          </button>
        </div>
        {footage.length ? <div className="space-y-2">
          {footage.map((entry) => <button
            key={entry.name}
            type="button"
            className={`analysis-session-button w-full text-left ${selectedFootage === entry.name ? "analysis-session-button-active" : ""}`}
            onClick={() => setSelectedFootage(entry.name)}
          >
            <b>{entry.name}</b>
            <div className="text-xs text-slate-400">
              {entry.extractedFrames} frames · {entry.width}x{entry.height} · {entry.fps.toFixed(1)} fps
            </div>
          </button>)}
        </div> : <p className="text-sm text-slate-400">
          No footage found. Extract with{" "}
          <code className="text-cyan-200">npm run cv:video:extract -- -Video &quot;…&quot; -Name &quot;match-01&quot;</code>
        </p>}
        {selectedFootageEntry && <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="text-sm text-slate-300">Interval (s)
            <input type="number" min={0.25} step={0.25} value={interval} onChange={(event) => setInterval(Number(event.target.value))} className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2" />
          </label>
          <label className="text-sm text-slate-300">Max frames
            <input type="number" min={10} step={10} value={maxFrames} onChange={(event) => setMaxFrames(Number(event.target.value))} className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2" />
          </label>
          <label className="flex items-end gap-2 pb-2 text-sm text-slate-300">
            <input type="checkbox" checked={runYolo} onChange={(event) => setRunYolo(event.target.checked)} />
            Run YOLO
          </label>
          <label className="flex items-end gap-2 pb-2 text-sm text-slate-300 sm:col-span-3">
            <input type="checkbox" checked={replayCoach} onChange={(event) => setReplayCoach(event.target.checked)} />
            Offline coach replay (slower; writes replay-events.json)
          </label>
        </div>}
        <button
          type="button"
          className="cv-primary-button mt-4 inline-flex items-center gap-2"
          disabled={!selectedFootage || busy === "review"}
          onClick={() => void handleRunReview()}
        >
          <Play size={16} /> {busy === "review" ? "Running…" : "Run CV Review"}
        </button>
      </section>

      <section className="cv-panel">
        <h3 className="mb-4 flex items-center gap-2 text-lg font-bold text-white"><BarChart3 size={18} /> Past Reviews</h3>
        {reviews.length ? <div className="space-y-2 max-h-72 overflow-y-auto">
          {reviews.map((review) => <button
            key={review.id}
            type="button"
            className={`analysis-session-button w-full text-left ${selectedReviewId === review.id ? "analysis-session-button-active" : ""}`}
            onClick={() => setSelectedReviewId(review.id)}
          >
            <b>{review.footageName}</b>
            <div className="text-xs text-slate-400">
              {new Date(review.createdAt).toLocaleString()} · {review.dominantScreen} · {review.draftEvents} draft events
            </div>
          </button>)}
        </div> : <p className="text-sm text-slate-400">No reviews yet.</p>}
      </section>
    </div>

    {detail && <section className="cv-panel">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-lg font-bold text-white"><Clock3 size={18} /> Timeline — {detail.footageName}</h3>
        <div className="flex flex-wrap gap-2 text-sm">
          <Link to={detail.coachIntegration.links.draftRoom} className="text-cyan-300 underline">Draft Room</Link>
          <Link to={detail.coachIntegration.links.gameAnalysis} className="text-cyan-300 underline">Game Analysis</Link>
          <Link to={detail.coachIntegration.links.cvStudioVideo} className="text-cyan-300 underline">Video Annotator</Link>
        </div>
      </div>
      <p className="mb-4 text-sm text-slate-400">
        Dominant screen: <strong className="text-white">{detail.summary.dominantScreen}</strong>
        {" · "}Draft {formatTime(detail.summary.draftSeconds)}
        {" · "}Live HUD {formatTime(detail.summary.liveHudSeconds)}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-slate-400">
              <th className="py-2 pr-4">Start</th>
              <th className="py-2 pr-4">End</th>
              <th className="py-2 pr-4">Screen</th>
              <th className="py-2 pr-4">Confidence</th>
              <th className="py-2">Samples</th>
            </tr>
          </thead>
          <tbody>
            {detail.segments.map((segment, index) => <tr key={`${segment.screen}-${index}`} className="border-b border-slate-900">
              <td className="py-2 pr-4 font-mono text-cyan-100">{formatTime(segment.startSeconds)}</td>
              <td className="py-2 pr-4 font-mono text-cyan-100">{formatTime(segment.endSeconds)}</td>
              <td className="py-2 pr-4">{segment.screen}</td>
              <td className="py-2 pr-4">{segment.meanConfidence.toFixed(2)}</td>
              <td className="py-2">{segment.sampleCount}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
      {detail.replayEvents && detail.replayEvents.length > 0 && <div className="mt-4">
        <h4 className="mb-2 font-bold text-white">Offline coach replay ({detail.replayEvents.length} events)</h4>
        <ul className="max-h-48 space-y-1 overflow-y-auto text-sm text-slate-300">
          {detail.replayEvents.slice(0, 24).map((event, index) => <li key={index}>
            {event.timestampSeconds !== null ? formatTime(event.timestampSeconds) : "—"} — {event.ruleId}: {event.callout}
          </li>)}
        </ul>
      </div>}
      {detail.draftEvents.length > 0 && <div className="mt-4">
        <h4 className="mb-2 font-bold text-white">Draft / match events</h4>
        <ul className="space-y-1 text-sm text-slate-300">
          {detail.draftEvents.map((event, index) => <li key={index}>
            {formatTime(event.timestampSeconds)} — {event.type.replace(/_/g, " ")} (conf {event.confidence.toFixed(2)})
          </li>)}
        </ul>
      </div>}
    </section>}

    <p className="text-sm text-slate-500" role="status">{message}</p>
  </div>;
}
