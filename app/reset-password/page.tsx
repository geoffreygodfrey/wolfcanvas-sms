import { Suspense } from "react";
import ResetPasswordForm from "./ResetPasswordForm";

export const dynamic = "force-dynamic";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<p className="py-16 text-center text-sm text-muted">Loading…</p>}>
      <ResetPasswordForm />
    </Suspense>
  );
}