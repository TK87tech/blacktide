export type Surface = "water" | "land";
export type Status = "verified" | "unverified" | "false_positive";

export interface EventFeatures {
  vv_db: number | null;
  vh_db: number | null;
  vv_vh_db: number | null;
  glcm_entropy: number | null;
  ndvi_delta: number | null;
  ndwi: number | null;
  osi: number | null;
}

export interface SpillEvent {
  id: string;
  date: string;
  site: string;
  lga: string;
  state: string;
  surface: Surface;
  area_ha: number;
  confidence: number;
  status: Status;
  model: string;
  sensors: string[];
  nosdra_match: boolean | null;
  people_5km: number;
  mangrove_ha: number;
  wind_ms?: number | null;
  /** "cerulean" for SkyTruth Cerulean imports; absent for BlackTide's own models. */
  source?: string;
  source_url?: string;
  /** Cerulean's reviewed source category, e.g. "Infrastructure", "Vessel". */
  cause?: string | null;
  features: EventFeatures;
  lon: number;
  lat: number;
}

export interface Meta {
  sample: boolean;
  generated_at: string;
  period_start: string;
  period_end: string;
  model_version: string;
  aoi: string;
  source: string;
}

export interface ModelMetrics {
  key: string;
  name: string;
  overall_accuracy: number;
  kappa: number;
  precision: number;
  recall: number;
  f1: number;
  domain?: "water" | "land";
  verified_recall?: number | null;
  verified_oil_n?: number;
  lookalike_false_alarm?: number | null;
  clean_water_false_alarm?: number | null;
  confusion: { labels: string[]; matrix: number[][] };
  feature_importance: { feature: string; importance: number }[] | null;
  pr_curve: { recall: number; precision: number }[];
}

export interface MetricsFile {
  sample: boolean;
  train_samples: number;
  test_samples: number;
  split: string;
  models: ModelMetrics[];
}
