export const metadata = { title: "Method — BlackTide" };

const STEPS = [
  {
    n: "01",
    title: "Sea & coast: SkyTruth Cerulean",
    body: "Oil on open water is taken from SkyTruth Cerulean, which runs a deep-learning slick detector on every Sentinel-1 radar pass and has part of its output reviewed by people. BlackTide adds context to each slick: nearest community, people within 5 km (WorldPop) and mangrove area.",
  },
  {
    n: "02",
    title: "Land, swamp & creeks: official reports",
    body: "Every spill reported to NOSDRA since 2015 (Nigerian Oil Spill Monitor, from Joint Investigation Visits) is mapped with its operator, reported cause, volume and habitat. For land and swamp reports, BlackTide checks from space whether the spill left visible damage: vegetation change at the site (100 m) against its surroundings (300–1,000 m), dry season before vs after, on Sentinel-2 NDVI and Sentinel-1 radar. Tested on 133 reports vs 139 spill-free points: clear local die-back at 23% of reported spills and 1% of controls.",
  },
  {
    n: "03",
    title: "Land, creeks & estuaries: BlackTide detection (in development)",
    body: "Cerulean doesn't cover inland areas, so BlackTide looks for what oil does there: it kills vegetation. Dry-season Sentinel-2 NDVI is compared year on year to find sudden die-off of healthy mangrove, swamp forest and farmland, flagging patches beside creeks.",
  },
  {
    n: "04",
    title: "Human review",
    body: "Die-off has other causes too (clearing, fire, flooding), so each candidate is checked by an analyst on before/after imagery. Confirmed and rejected sites both become training labels.",
  },
  {
    n: "05",
    title: "Land model",
    body: "A Random Forest trained on those labels uses monthly Sentinel-1 radar (which sees through cloud) and Sentinel-2 indices — NDVI change, NDWI, MNDWI, the Oil Spill Index — with a radar-only fallback when clouds hide every optical scene.",
  },
  {
    n: "06",
    title: "Research comparison",
    body: "BlackTide's own marine models (Random Forest and a neural network on per-pass radar, local darkness, wind and incidence angle) are trained on Cerulean's reviewed slicks and reported on the Model page — but not used for the map, because pixel-level models raise too many false alarms over open sea.",
  },
  {
    n: "07",
    title: "Validate & repeat",
    body: "Everything runs on free tools. A monthly GitHub Action imports new Cerulean slicks, runs the land model and republishes the site.",
  },
];

const STACK = [
  ["Satellite processing", "Google Earth Engine (free, non-commercial)"],
  ["Marine detections", "SkyTruth Cerulean (open Sentinel-1 slick detections)"],
  ["Official spill reports", "NOSDRA — Nigerian Oil Spill Monitor"],
  ["Administrative boundaries", "geoBoundaries (states and LGAs)"],
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
  "Land events are dated by the month (or dry season) they were detected, not the exact spill date; marine events carry the exact satellite pass date.",
  "Cerulean's machine detections that no one has reviewed yet are shown as unverified.",
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
        Marine and coastal slick detections: SkyTruth Cerulean (cerulean.skytruth.org). Official spill reports: National Oil Spill Detection and Response Agency (NOSDRA), Nigerian Oil Spill Monitor (oilspillmonitor.ng). Boundaries: geoBoundaries (CC BY 4.0). Contains modified Copernicus Sentinel data. Sentinel-2 cloudless mosaics © EOX IT Services GmbH, CC BY-NC-SA 4.0.
      </p>
    </div>
  );
}
