// Chart + map colours (dark mode). Series slots validated with the dataviz palette checker.
export const C = {
  surface: "#1a1a19",
  page: "#0d0d0d",
  ink: "#ffffff",
  ink2: "#c3c2b7",
  muted: "#898781",
  grid: "#2c2c2a",
  axis: "#383835",
  water: "#3987e5", // categorical slot 1
  land: "#d95926", // categorical slot 2
  seq: ["#cde2fb", "#86b6ef", "#3987e5", "#1c5cab", "#104281"],
  status: {
    verified: "#d03b3b", // critical
    unverified: "#fab219", // warning
    false_positive: "#898781", // neutral
  },
} as const;
