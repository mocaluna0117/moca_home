import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const raw = Array.isArray(params.from) ? params.from[0] : params.from;
  // Only accept same-site paths — never an absolute URL from the query string.
  const from = raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";

  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <LoginForm from={from} />
    </div>
  );
}
