import Sky from "@/components/Sky.tsx";
import { homeView } from "@/lib/home.ts";

export default function Page() {
  return <Sky home={homeView()} />;
}
