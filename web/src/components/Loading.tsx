export default function Loading({ error, label = "Loading events…" }: { error?: boolean; label?: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-10 text-sm text-muted">
      {error ? "Couldn't load the data — please refresh." : label}
    </div>
  );
}
