import type { Metadata } from "next";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";
import Nav from "@/components/Nav";
import { getMeta } from "@/lib/data";

export const metadata: Metadata = {
  title: "BlackTide — Niger Delta Oil Spill Intelligence",
  description:
    "Satellite + AI monitoring of oil spill contamination across the Niger Delta, built on Sentinel-1 SAR and Sentinel-2 imagery.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  const meta = getMeta();
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <Nav />
        {meta.sample && (
          <div className="border-b border-line bg-[#2a2210] px-4 py-1.5 text-center text-xs text-[#f5d27a]">
            ⚠ Showing <strong>sample data</strong> for demonstration. Real detections appear once the Earth Engine
            pipeline has run.
          </div>
        )}
        <main className="flex flex-1 flex-col">{children}</main>
      </body>
    </html>
  );
}
