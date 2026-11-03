import { notFound } from "next/navigation";

export default function OsSmokePage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }
  // Shell is provided by layout.tsx
  return null;
}
