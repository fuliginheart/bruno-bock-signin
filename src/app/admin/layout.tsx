import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ADMIN_COOKIE_NAME, verifySession } from "@/server/auth";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const c = await cookies();
  const tok = c.get(ADMIN_COOKIE_NAME)?.value;
  if (!verifySession(tok)) {
    redirect("/");
  }
  return (
    <div className="min-h-screen">
      <nav className="flex flex-wrap items-center gap-2 border-b border-neutral-800 bg-neutral-900 px-6 py-4">
        <Link href="/admin" className="mr-4 text-lg font-semibold">
          Admin
        </Link>
        <NavLink href="/admin/employees">Employees</NavLink>
        <NavLink href="/admin/visitors">Visitors</NavLink>
        <NavLink href="/admin/audit">Audit Log</NavLink>
        <NavLink href="/admin/muster">Muster</NavLink>
        <NavLink href="/admin/kiosks">Kiosks</NavLink>
        <NavLink href="/admin/pin">Change PIN</NavLink>
        <NavLink href="/admin/settings">Settings</NavLink>
        <span className="ml-auto" />
        <Link
          href="/"
          className="rounded-lg bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700"
        >
          Back to roster
        </Link>
      </nav>
      <div className="px-6 py-6">{children}</div>
    </div>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-lg px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-800"
    >
      {children}
    </Link>
  );
}
