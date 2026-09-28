"""Random Forest classifiers in Earth Engine.

Two models are trained from the same samples:
  * fused    — SAR + optical features, used wherever Sentinel-2 saw the ground
  * sar_only — SAR features only, the fallback under persistent cloud
"""

import ee

from .config import ALL_FEATURES, RF_TREES, SAR_FEATURES


def train(samples: ee.FeatureCollection) -> tuple[ee.Classifier, ee.Classifier]:
    train_set = samples.filter(ee.Filter.lt("random", 0.8))
    fused = (
        ee.Classifier.smileRandomForest(numberOfTrees=RF_TREES, seed=87)
        .setOutputMode("PROBABILITY")
        .train(train_set.filter(ee.Filter.notNull(ALL_FEATURES)), "class", ALL_FEATURES)
    )
    sar_only = (
        ee.Classifier.smileRandomForest(numberOfTrees=RF_TREES, seed=87)
        .setOutputMode("PROBABILITY")
        .train(train_set, "class", SAR_FEATURES)
    )
    return fused, sar_only


def probability(features: ee.Image, fused: ee.Classifier, sar_only: ee.Classifier) -> ee.Image:
    p_fused = features.select(ALL_FEATURES).classify(fused)
    p_sar = features.select(SAR_FEATURES).classify(sar_only)
    return p_fused.unmask(p_sar).rename("p_oil")
