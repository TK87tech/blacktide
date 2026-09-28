export const metadata = { title: "Method — BlackTide" };

const STEPS = [
  {
    n: "01",
    title: "Acquire",
    body: "Sentinel-1 GRD (C-band SAR, IW mode, VV+VH) and Sentinel-2 surface reflectance for the Niger Delta, 2017 onwards, pulled directly inside Google Earth Engine — no downloads.",
  },
  {
    n: "02",
    title: "Preprocess",
    body: "SAR: calibrated, terrain-corrected sigma0 → border-noise mask → speckle filter → dB. Optical: Cloud Score+ masking, monthly median composites. Radar sees through the Delta's near-constant cloud; optical adds vegetation and colour evidence when the sky clears.",
  },
  {
    n: "03",
    title: "Extract features",
    body: "VV and VH backscatter, VV/VH ratio, GLCM texture (entropy, contrast, correlation) from SAR; NDVI, year-on-year NDVI change, NDWI, MNDWI and the Oil Spill Index from Sentinel-2.",
  },
  {
    n: "04",
    title: "Classify",
    body: "Random Forest (300 trees) predicts the probability of oil per 20 m pixel. A SAR-only model fills in wherever clouds hid every optical scene that month. A neural network (MLP) is trained on the same samples for comparison.",
  },
  {
    n: "05",
    title: "Vectorise & enrich",
    body: "Pixels above 0.7 probability are grouped into events; specks under ~0.4 ha are dropped. Each event gets its area, water/land context (JRC Global Surface Water), people within 5 km (WorldPop) and mangrove area.",
  },
  {
    n: "06",
    title: "Validate",
    body: "Events start unverified. Analysts confirm or reject them against NOSDRA reports, imagery and field visits; each decision becomes a new training label, so the model improves with use.",
  },
];

const STACK = [
  ["Satellite processing", "Google Earth Engine (free, non-commercial)"],
  ["Machine learning", "Earth Engine smileRandomForest · scikit-learn"],
  ["Automation", "GitHub Actions (scheduled monthly run)"],
  ["Web app", "Next.js static export · MapLibre GL · Recharts"],
  ["Hosting", "GitHub Pages"],
  ["Basemaps", "Sentinel-2 cloudless (EOX) · OpenFreeMap / OpenStreetMap"],
];

const LIMITS = [
  "Dark patches on radar are not always oil: low wind, rain cells, algae and mudflats look similar. The model learns these look-alikes only if they are labelled.",
  "Land spills under dense mangrove canopy are harder to see than slicks on open water.",
  "Sentinel-1B failed in December 2021, halving revisit frequency until Sentinel-1C came online in 2025 — fewer looks means more missed short-lived slicks in that period.",
  "Event dates are the month of detection, not the exact spill date.",
];

export default function MethodPage() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <h1 className="text-3xl font-semibold tracking-tight">How BlackTide works</h1>
      <p className="mt-2 max-w-2xl text-ink-2">
        The Niger Delta&apos;s 50,000 km² of creeks, mangroves and swamp make ground surveys slow, dangerous and
        incomplete, and official spill figures vary widely between agencies and operators. BlackTide watches the whole
        region from orbit, every month, and makes what it finds open to everyone.
      </p>

      <ol className="mt-8 grid gap-3 sm:grid-cols-2">
        {STEPS.map((s) => (
          <li key={s.n} className="card p-4">
            <div className="tabular text-xs text-muted">{s.n}</div>
            <h2 className="mt-1 font-semibold">{s.title}</h2>
            <p className="mt-1 text-sm leading-relaxed text-ink-2">{s.body}</p>
          </li>
        ))}
      </ol>

      <h2 className="mt-10 text-lg font-semibold">Known limitations</h2>
      <ul className="mt-3 space-y-2 text-sm text-ink-2">
        {LIMITS.map((l) => (
          <li key={l} className="flex gap-2">
            <span className="text-muted">—</span>
            {l}
          </li>
        ))}
      </ul>

      <h2 className="mt-10 text-lg font-semibold">Built entirely on free and open tools</h2>
      <table className="mt-3 w-full text-sm">
        <tbody>
          {STACK.map(([k, v]) => (
            <tr key={k} className="border-b border-line/50">
              <td className="py-2 pr-4 text-muted">{k}</td>
              <td className="py-2">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="mt-10 text-lg font-semibold">Research team</h2>
      <p className="mt-2 text-sm text-ink-2">
        ThankGod Chinemerem Ugwuada · Ikenna Okonkwo Anthony · Tochukwu Ambrose Ngwu
      </p>
      <p className="mt-6 text-xs text-muted">
        Contains modified Copernicus Sentinel data. Sentinel-2 cloudless mosaics © EOX IT Services GmbH, CC BY-NC-SA 4.0.
      </p>
    </div>
  );
}
