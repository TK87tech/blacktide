import Card from "@/components/Card";
import { ImportanceChart, PRChart } from "@/components/charts";
import { getMetrics } from "@/lib/data";
import { fmtInt } from "@/lib/format";
import type { ModelMetrics } from "@/lib/types";

export const metadata = { title: "Model — BlackTide" };

export default function ModelPage() {
  const m = getMetrics();
  const rf = m.models.find((x) => x.key === "rf");

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <h1 className="text-2xl font-semibold tracking-tight">Model performance</h1>
      <p className="mb-5 text-sm text-ink-2">
        {fmtInt(m.train_samples)} training / {fmtInt(m.test_samples)} held-out test samples ({m.split}).
        {m.sample && " Figures shown are placeholders until the models are trained on real labels."}
      </p>

      <div className="grid gap-3 md:grid-cols-2">
        {m.models.map((model) => (
          <ModelCard key={model.key} model={model} />
        ))}
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card title="Precision–recall" desc="How precision holds up as the model is pushed to catch more spills">
          <PRChart series={m.models.map((x) => ({ name: x.name, points: x.pr_curve }))} />
        </Card>
        {rf?.feature_importance && (
          <Card title="What the Random Forest relies on" desc="Mean decrease in impurity across trees">
            <ImportanceChart data={rf.feature_importance} />
          </Card>
        )}
      </div>
    </div>
  );
}

function ModelCard({ model }: { model: ModelMetrics }) {
  const [[tp, fn], [fp, tn]] = model.confusion.matrix;
  const max = Math.max(tp, fn, fp, tn);
  const cell = (v: number, good: boolean, label: string) => (
    <div
      className="flex flex-col items-center justify-center rounded-md py-4"
      style={{ background: `rgba(${good ? "57,135,229" : "217,89,38"}, ${0.12 + (0.55 * v) / max})` }}
    >
      <div className="tabular text-xl font-semibold">{fmtInt(v)}</div>
      <div className="text-[11px] text-ink-2">{label}</div>
    </div>
  );

  return (
    <Card title={model.name}>
      <div className="grid grid-cols-5 gap-2">
        {(
          [
            ["Accuracy", model.overall_accuracy],
            ["Kappa", model.kappa],
            ["Precision", model.precision],
            ["Recall", model.recall],
            ["F1", model.f1],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="rounded-lg bg-surface-2 p-2 text-center">
            <div className="tabular text-lg font-semibold">{v.toFixed(2)}</div>
            <div className="text-[11px] text-muted">{k}</div>
          </div>
        ))}
      </div>
      <div className="mt-4 text-xs text-muted">Confusion matrix (test set)</div>
      <div className="mt-2 grid grid-cols-[auto_1fr_1fr] items-center gap-2 text-xs">
        <span />
        <span className="text-center text-ink-2">Predicted oil</span>
        <span className="text-center text-ink-2">Predicted clean</span>
        <span className="text-ink-2">Actual oil</span>
        {cell(tp, true, "true positive")}
        {cell(fn, false, "missed spill")}
        <span className="text-ink-2">Actual clean</span>
        {cell(fp, false, "false alarm")}
        {cell(tn, true, "true negative")}
      </div>
    </Card>
  );
}
