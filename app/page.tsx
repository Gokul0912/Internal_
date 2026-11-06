import type { Metadata } from "next";
import Board from "./board";

export const metadata: Metadata = { title: "Product Hub", robots: { index: false, follow: false } };

export default function ProductHubPage() {
  const connected = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return <Board shared={Boolean(connected)} />;
}
