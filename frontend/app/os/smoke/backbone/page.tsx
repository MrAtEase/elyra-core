import { notFound } from "next/navigation";
import BackboneRunProof from "./BackboneRunProof";

export default function OsBackboneSmokePage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return <BackboneRunProof />;
}

