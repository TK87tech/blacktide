"""Step 2 — train and evaluate Random Forest and a neural network (MLP) for each
domain (water = per-pass, land = monthly) and publish the metrics to
web/data/model_metrics.json.

Uses the same 80/20 split column as the Earth Engine models, so the RF metrics
here describe the RF that detect.py runs across the Delta.

    py -3 pipeline/scripts/train.py            # writes pipeline/output/model_metrics.json
    py -3 pipeline/scripts/train.py --publish  # also writes web/data/model_metrics.json
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from sklearn.ensemble import RandomForestClassifier  # noqa: E402
from sklearn.impute import SimpleImputer  # noqa: E402
from sklearn.metrics import cohen_kappa_score, confusion_matrix, precision_recall_curve  # noqa: E402
from sklearn.neural_network import MLPClassifier  # noqa: E402
from sklearn.pipeline import make_pipeline  # noqa: E402
from sklearn.preprocessing import StandardScaler  # noqa: E402

from blacktide.config import ALL_FEATURES, OUTPUT, RF_TREES, SCENE_FEATURES, WATER_TREES, WEB_DATA  # noqa: E402

LABELS = {
    "VV": "VV backscatter", "VH": "VH backscatter", "VV_VH": "VV/VH ratio", "VV_local": "Local darkness",
    "GLCM_ent": "GLCM entropy", "GLCM_contrast": "GLCM contrast", "GLCM_corr": "GLCM correlation",
    "NDVI": "NDVI", "NDVI_delta": "NDVI change", "NDWI": "NDWI", "MNDWI": "MNDWI", "OSI": "OSI",
    "wind": "Wind speed", "angle": "Incidence angle",
}
DOMAINS = {"water": SCENE_FEATURES, "land": ALL_FEATURES}
MIN_PER_CLASS = 30


def false_alarm(test: pd.DataFrame, y_pred: np.ndarray, prefix: str):
    m = test["source"].astype(str).str.startswith(prefix).to_numpy()
    return (round(float(y_pred[m].mean()), 4), int(m.sum())) if m.any() else (None, 0)


def evaluate(key, name, domain, test, proba):
    y_true = test["class"].to_numpy()
    y_pred = (proba >= 0.5).astype(int)
    # Oil (1) first so the matrix reads [[TP, FN], [FP, TN]].
    (tp, fn), (fp, tn) = confusion_matrix(y_true, y_pred, labels=[1, 0])
    precision = tp / max(tp + fp, 1)
    recall = tp / max(tp + fn, 1)
    p, r, _ = precision_recall_curve(y_true, proba)
    idx = np.linspace(0, len(r) - 1, 21).astype(int)
    verified_oil = ((test["verified"] == 1) & (test["class"] == 1)).to_numpy()
    out = {
        "key": key,
        "name": name,
        "domain": domain,
        "overall_accuracy": round(float((tp + tn) / len(y_true)), 4),
        "kappa": round(float(cohen_kappa_score(y_true, y_pred)), 4),
        "precision": round(float(precision), 4),
        "recall": round(float(recall), 4),
        "f1": round(float(2 * precision * recall / max(precision + recall, 1e-9)), 4),
        "confusion": {"labels": ["Oil", "Non-oil"], "matrix": [[int(tp), int(fn)], [int(fp), int(tn)]]},
        # Recall on human-reviewed oil only — the least biased number here.
        "verified_recall": round(float(y_pred[verified_oil].mean()), 4) if verified_oil.any() else None,
        "verified_oil_n": int(verified_oil.sum()),
        "pr_curve": sorted(
            ({"recall": round(float(r[i]), 3), "precision": round(float(p[i]), 3)} for i in idx),
            key=lambda d: d["recall"],
        ),
    }
    if domain == "water":
        out["lookalike_false_alarm"], out["lookalike_n"] = false_alarm(test, y_pred, "lookalike")
        out["clean_water_false_alarm"], out["clean_water_n"] = false_alarm(test, y_pred, "water-scene")
    return out


def train_domain(domain: str, cols: list[str]):
    path = OUTPUT / f"training_{domain}.csv"
    if not path.exists():
        return None
    df = pd.read_csv(path)
    counts = df["class"].value_counts()
    if counts.get(0, 0) < MIN_PER_CLASS or counts.get(1, 0) < MIN_PER_CLASS:
        print(f"{domain}: skipped — needs {MIN_PER_CLASS}+ of each class (have {dict(counts)})")
        return None
    train, test = df[df.random < 0.8], df[df.random >= 0.8]
    X_tr, y_tr, X_te = train[cols], train["class"], test[cols]

    trees = WATER_TREES if domain == "water" else RF_TREES
    rf = RandomForestClassifier(n_estimators=trees, random_state=87, n_jobs=-1).fit(X_tr, y_tr)
    rf_m = evaluate(f"rf-{domain}", "Random Forest", domain, test, rf.predict_proba(X_te)[:, 1])
    rf_m["feature_importance"] = sorted(
        ({"feature": LABELS[f], "importance": round(float(v), 4)} for f, v in zip(cols, rf.feature_importances_)),
        key=lambda d: -d["importance"],
    )

    ann = make_pipeline(
        SimpleImputer(strategy="median"),
        StandardScaler(),
        MLPClassifier(hidden_layer_sizes=(64, 32), early_stopping=True, max_iter=500, random_state=87),
    ).fit(X_tr, y_tr)
    ann_m = evaluate(f"ann-{domain}", "Neural Network (MLP)", domain, test, ann.predict_proba(X_te)[:, 1])
    ann_m["feature_importance"] = None

    for m in (rf_m, ann_m):
        extra = ""
        if domain == "water":
            extra = f" look-alike FA={m['lookalike_false_alarm']} clean-water FA={m['clean_water_false_alarm']}"
        print(f"{domain} {m['name']}: OA={m['overall_accuracy']} kappa={m['kappa']} F1={m['f1']} "
              f"verified-oil recall={m['verified_recall']} (n={m['verified_oil_n']}){extra}")
    return {"train_samples": int(len(train)), "test_samples": int(len(test)), "models": [rf_m, ann_m]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--publish", action="store_true", help="write web/data/model_metrics.json")
    args = ap.parse_args()

    results = {d: r for d, cols in DOMAINS.items() if (r := train_domain(d, cols))}
    out = {
        "sample": False,
        "split": "80/20 random",
        "train_samples": sum(r["train_samples"] for r in results.values()),
        "test_samples": sum(r["test_samples"] for r in results.values()),
        "domains": {d: {"train_samples": r["train_samples"], "test_samples": r["test_samples"]} for d, r in results.items()},
        "models": [m for r in results.values() for m in r["models"]],
    }
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / "model_metrics.json").write_text(json.dumps(out, indent=2))
    if args.publish:
        (WEB_DATA / "model_metrics.json").write_text(json.dumps(out, indent=2))
        print("Published to web/data/model_metrics.json")


if __name__ == "__main__":
    main()
