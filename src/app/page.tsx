import RosterClient from "@/components/RosterClient";
import AdminGate from "@/components/AdminGate";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <>
      <RosterClient />
      <AdminGate />
    </>
  );
}
