"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, LogIn } from "lucide-react";
import Image from "next/image";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    // Mock login - in real app would call API
    await new Promise((r) => setTimeout(r, 800));

    if (email === "demo@example.com" && password === "demo123") {
      router.push("/dashboard");
    } else if (email && password) {
      // For demo, accept any email/password
      router.push("/dashboard");
    } else {
      setError("Введите email и пароль");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f4f5f7] p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <div className="w-12 h-12 bg-[#2563eb] rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-xl">C</span>
          </div>
        </div>

        {/* Card */}
        <div className="bg-white rounded-lg shadow-[0_4px_12px_rgba(0,0,0,0.08)] p-6">
          <h1 className="text-[22px] font-bold text-[#1f2328] text-center mb-1">
            Вход в CRM
          </h1>
          <p className="text-sm text-[#6b7280] text-center mb-6">
            Введите данные для входа в систему
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email */}
            <div>
              <label className="block text-xs font-semibold text-[#1f2328] mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="demo@example.com"
                className="w-full h-10 px-3 text-sm border border-[#e3e6eb] rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563eb] focus:border-transparent"
                required
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-semibold text-[#1f2328] mb-1.5">
                Пароль
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="demo123"
                  className="w-full h-10 px-3 pr-10 text-sm border border-[#e3e6eb] rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563eb] focus:border-transparent"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9ca3af] hover:text-[#6b7280]"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <p className="text-sm text-[#dc2626] bg-[#fee2e2] px-3 py-2 rounded-md">
                {error}
              </p>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full h-10 bg-[#2563eb] hover:bg-[#1d4ed8] text-white text-sm font-semibold rounded-md transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <LogIn className="w-4 h-4" />
                  Войти
                </>
              )}
            </button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-xs text-[#9ca3af] text-center mt-6">
          Нет аккаунта? Обратитесь к администратору
        </p>
      </div>
    </div>
  );
}
