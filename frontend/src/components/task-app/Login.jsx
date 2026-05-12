import { useState } from "react";
import { getAppConfig } from "../../runtime-config.js";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const formatName = (value) =>
  value
    .replace(/\s+/g, " ")
    .trimStart()
    .split(" ")
    .filter(Boolean)
    .map((word) => word.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).join("-"))
    .join(" ");

function EyeIcon({ open }) {
  return open ? (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" x2="22" y1="2" y2="22" />
    </svg>
  );
}

export default function Login({ onLogin, initialSignupRequired, initialMode, onBackToLanding }) {
  const [mode, setMode] = useState(initialMode === "signup" ? "signup" : "signin");
  const isSignup = mode === "signup";
  const isInitialSignup = initialSignupRequired && isSignup;
  const appName = getAppConfig().appTitle || "Taskline";
  const defaultWorkspaceName = appName || "Taskline";
  const signupButtonLabel = isInitialSignup ? "Create first account" : "Create account";
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);


  // Show the email error as soon as it's clearly wrong — once they've typed "@",
  // hit 5+ chars, or left the field. No need to wait for submit.
  const emailLooksWrong = email.length > 0 && !EMAIL_REGEX.test(email);
  const emailInvalid = isSignup && emailLooksWrong && (emailTouched || email.includes("@") || email.length >= 5);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const apiBaseUrl = getAppConfig().apiBaseUrl || "";
      if (isSignup && !EMAIL_REGEX.test(email)) {
        setError("Please enter a valid email address (e.g. you@example.com).");
        setEmailTouched(true);
        setLoading(false);
        return;
      }
      if (isSignup && password !== confirmPassword) {
        setError("Passwords do not match.");
        setLoading(false);
        return;
      }

      const endpoint = isSignup ? "/signup" : "/login";
      const payload = isSignup
        ? {
            firstName,
            lastName,
            username,
            email,
            password,
            workspaceName: defaultWorkspaceName,
          }
        : { username, password };

      const res = await fetch(`${apiBaseUrl}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.ok) {
        onLogin(data.username || username);
      } else {
        setError(data.error || (isSignup
          ? "Could not create your account."
          : "Incorrect username or password. Please try again."));
      }
    } catch {
      setError("Could not reach the server. Please check your connection.");
    } finally {
      setLoading(false);
    }
  }

  const canSubmit = !loading && (!isSignup || EMAIL_REGEX.test(email));

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-10">
      <div className={`w-full ${isSignup ? "max-w-xl" : "max-w-sm"}`}>
        {onBackToLanding && (
          <button
            type="button"
            onClick={onBackToLanding}
            className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 transition-colors hover:text-gray-800"
          >
            <span aria-hidden="true">←</span> Back to home
          </button>
        )}

        <div className="bg-white rounded-2xl shadow-md p-8">
          <h1 className="text-2xl font-semibold text-gray-800 mb-1">Taskline</h1>
          <p className="text-sm text-gray-500 mb-6">
            {isInitialSignup ? "Create the first account for this workspace" : isSignup ? "Create your account" : "Sign in to continue"}
          </p>

          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
            <div className={isSignup ? "grid grid-cols-1 gap-4 sm:grid-cols-2" : "flex flex-col gap-4"}>
              {isSignup && (
                <>
                  <div className="flex flex-col gap-1">
                    <label className="text-sm font-medium text-gray-700">First name</label>
                    <input
                      type="text"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      onBlur={(e) => setFirstName(formatName(e.target.value))}
                      required
                      autoFocus
                      maxLength={50}
                      className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-sm font-medium text-gray-700">Last name</label>
                    <input
                      type="text"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      onBlur={(e) => setLastName(formatName(e.target.value))}
                      required
                      maxLength={50}
                      className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div className="flex flex-col gap-1 sm:col-span-2">
                    <label className="text-sm font-medium text-gray-700">Email</label>
                    <input
                      type="text"
                      inputMode="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value.trim())}
                      onBlur={() => setEmailTouched(true)}
                      onInvalid={(e) => e.preventDefault()}
                      required
                      maxLength={254}
                      autoCapitalize="none"
                      aria-invalid={emailInvalid || undefined}
                      aria-describedby={emailInvalid ? "signup-email-error" : undefined}
                      className={`border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
                        emailInvalid
                          ? "border-red-400 focus:ring-red-400 bg-red-50/40"
                          : "border-gray-300 focus:ring-blue-500"
                      }`}
                    />
                    {emailInvalid && (
                      <p
                        id="signup-email-error"
                        className="mt-1 flex items-center gap-1.5 text-xs font-medium text-red-600"
                      >
                        <span aria-hidden="true">⚠</span>
                        Please enter a valid email (e.g. you@example.com).
                      </p>
                    )}
                  </div>
                </>
              )}

              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">
                  {isSignup ? "Username" : "Username or email"}
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  autoFocus={!isSignup}
                  maxLength={isSignup ? 32 : 254}
                  autoCapitalize="none"
                  placeholder={isSignup ? "your_handle" : "you@example.com or your_handle"}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    maxLength={128}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    tabIndex={-1}
                  >
                    <EyeIcon open={showPassword} />
                  </button>
                </div>
              </div>

              {isSignup && (
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700">Confirm password</label>
                  <input
                    type={showPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    maxLength={128}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              )}
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2">
                <span className="text-red-500 mt-0.5">⚠</span>
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={!canSubmit}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium py-2 rounded-lg transition-colors"
            >
              {loading ? (isSignup ? "Creating account…" : "Signing in…") : (isSignup ? signupButtonLabel : "Sign in")}
            </button>
          </form>

          <div className="mt-5 border-t border-gray-100 pt-4 text-sm text-gray-600">
            {isSignup ? "Already have an account?" : "Need an account?"}{" "}
            <button
              type="button"
              onClick={() => {
                setError("");
                setMode(isSignup ? "signin" : "signup");
              }}
              className="font-medium text-blue-600 hover:text-blue-700"
            >
              {isSignup ? "Sign in" : "Sign up"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
