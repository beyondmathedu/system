import { redirect } from "next/navigation";
import { getViewerContext } from "@/lib/authz";

export default async function HomePage() {
  const viewer = await getViewerContext();
  if (!viewer.userId) redirect("/login");
  redirect("/home");
}
