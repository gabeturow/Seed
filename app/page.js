import { redirect } from "next/navigation";
import { requireApproved } from "@/lib/auth";

// Ask is the front door: signing in lands here.
export default async function Home() {
  await requireApproved();
  redirect("/ask");
}
