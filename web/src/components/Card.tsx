export default function Card({
  title,
  desc,
  children,
  className = "",
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`card p-4 ${className}`}>
      <h2 className="text-sm font-semibold">{title}</h2>
      {desc && <p className="mb-3 text-xs text-ink-2">{desc}</p>}
      {children}
    </div>
  );
}
