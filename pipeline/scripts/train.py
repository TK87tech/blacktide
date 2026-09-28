"""Step 2 — train and evaluate Random Forest and a neural network (MLP) on the
training table, and publish the metrics to web/data/model_metrics.json.

Uses the same 80/20 split column as the Earth Engine models, so the RF metrics
here describe the RF that detect.py runs across the Delta.

    py -3 pipeline/scripts/train.py
"""

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

from blacktide.config import ALL_FEATURES, OUTPUT, RF_TREES, WEB_DATA  # noqa: E402

LABELS = {
    "VV": "VV backscatter", "VH": "VH backscatter", "VV_VH": "VV/VH ratio",
    "GLCM_ent": "GLCM entropy", "GLCM_contrast": "GLCM contrast", "GLCM_corr": "GLCM correlation",
    "NDVI": "NDVI", "NDVI_delta": "NDVI change", "NDWI": "NDWI", "MNDWI": "MNDWI", "OSI": "OSI",
}


def evaluate(key, name, y_true, proba, verified_oil=None):
    y_pred = (proba >= 0.5).astype(int)
    # Oil (1) first so the matrix reads [[TP, FN], [FP, TN]].
    (tp, fn), (fp, tn) = confusion_matrix(y_true, y_pred, labels=[1, 0])
    precision = tp / max(tp + fp, 1)
    recall = tp / max(tp + fn, 1)
    p, r, _ = precision_recall_curve(y_true, proba)
    idx = np.linspace(0, len(r) - 1, 21).astype(int)
    return {
        "key": key,
        "name": name,
        "overall_accuracy": round(float((tp + tn) / len(y_true)), 4),
        "kappa": round(float(cohen_kappa_score(y_true, y_pred)), 4),
        "precision": round(float(precision), 4),
        "recall": round(float(recall), 4),
        "f1": round(float(2 * precision * recall / max(precision + recall, 1e-9)), 4),
        "confusion": {"labels": ["Oil", "Non-oil"], "matrix": [[int(tp), int(fn)], [int(fp), int(tn)]]},
        # Recall on human-reviewed oil only — the least biased number here.
        "verified_recall": None if verified_oil is None or not verified_oil.any()
        else round(float(y_pred[verified_oil].mean()), 4),
        "verified_oil_n": 0 if verified_oil is None else int(verified_oil.sum()),
        "pr_curve": sorted(
            ({"recall": round(float(r[i]), 3), "precision": round(float(p[i]), 3)} for i in idx),
            key=lambda d: d["recall"],
        ),
    }


def main():
    df = pd.read_csv(OUTPUT / "training_samples.csv")
    train, test = df[df.random < 0.8], df[df.random >= 0.8]
    X_tr, y_tr, X_te, y_te = train[ALL_FEATURES], train["class"], test[ALL_FEATURES], test["class"]
    verified_oil = ((test.get("verified", 0) == 1) & (test["class"] == 1)).to_numpy()

    rf = RandomForestClassifier(n_estimators=RF_TREES, random_state=87, n_jobs=-1).fit(X_tr, y_tr)
    rf_m = evaluate("rf", "Random Forest", y_te, rf.predict_proba(X_te)[:, 1], verified_oil)
    rf_m["feature_importance"] = sorted(
        ({"feature": LABELS[f], "importance": round(float(v), 4)} for f, v in zip(ALL_FEATURES, rf.feature_importances_)),
        key=lambda d: -d["importance"],
    )

    ann = make_pipeline(
        SimpleImputer(strategy="median"),
        StandardScaler(),
        MLPClassifier(hidden_layer_sizes=(64, 32), early_stopping=True, max_iter=500, random_state=87),
    ).fit(X_tr, y_tr)
    ann_m = evaluate("ann", "Neural Network (MLP)", y_te, ann.predict_proba(X_te)[:, 1], verified_oil)
    ann_m["feature_importance"] = None

    out = {
        "sample": False,
        "train_samples": int(len(train)),
        "test_samples": int(len(test)),
        "split": "80/20 random",
        "models": [rf_m, ann_m],
    }
    (WEB_DATA / "model_metrics.json").write_text(json.dumps(out, indent=2))
    for m in (rf_m, ann_m):
        print(f"{m['name']}: OA={m['overall_accuracy']} kappa={m['kappa']} F1={m['f1']} "
              f"verified-oil recall={m['verified_recall']} (n={m['verified_oil_n']})")


if __name__ == "__main__":
    main()
