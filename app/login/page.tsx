import { Suspense } from "react";
import Link from "next/link";
import LoginForm from "./LoginForm";

export const metadata = { title: "Sign in · Broadway Book" };

export default function LoginPage() {
  return (
    <main className="mx-auto w-full max-w-md px-4 pb-16 pt-2">
      <Link href="/" className="mb-3 inline-flex h-11 items-center text-lg text-bb-cue-gray active:text-bb-chart-white">
        ← All songs
      </Link>
      <h1 className="text-3xl font-bold tracking-tight">Sign in</h1>
      <p className="mb-6 mt-1 text-lg text-bb-cue-gray">
        To suggest chart changes and vote. Charts are always free to view without signing in.
      </p>
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
