"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Eye, EyeOff, UserPlus, CheckCircle, XCircle } from "lucide-react";
import { mockInvitations, roleLabels } from "@/lib/mock-data";

function AcceptContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token");

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  // Mock: find invitation by token (in real app, verify token on server)
  const invitation = mockInvitations.find((inv) => !inv.acceptedAt);
  const isExpired = invitation
    ? new Date(invitation.expiresAt) < new Date()
    : true;
  const isValid = !!token && !!invitation && !isExpired;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Пароли не совпадают");
      return;
    }

    if (password.length < 6) {
      setError("Пароль должен быть не менее 6 символов");
      return;
    }

    setLoading(true);
    await new Promise((r) => setTimeout(r, 1000));
    setLoading(false);
    setSuccess(true);

    // Redirect to login after 2 seconds
    setTimeout(() => router.push("/login"), 2000);
  };

  if (!isValid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f4f5f7] p-4">
        <div className="w-full max-w-sm">
          <div className="bg-white rounded-lg shadow-[0_4px_12px_rgba(0,0,0,0.08)] p-6 text-center">
            <div className="w-16 h-16 bg-[#fee2e2] rounded-full flex items-center justify-center mx-auto mb-4">
              <XCircle className="w-8 h-8 text-[#dc2626]" />
            </div>
            <h1 className="text-[22px] font-bold text-[#1f2328] mb-2">
              Ссылка недействительна
            </h1>
            <p className="text-sm text-[#6b7280] mb-6">
              {!token
                ? "Отсутствует токен приглашения"
                : isExpired
                ? "Срок действия приглашения истёк"
                : "Приглашение не найдено"}
            </p>
            <button
              onClick={() => router.push("/login")}
              className="w-full h-10 bg-[#2563eb] hover:bg-[#1d4ed8] text-white text-sm font-semibold rounded-md transition-colors"
            >
              Перейти к входу
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f4f5f7] p-4">
        <div className="w-full max-w-sm">
          <div className="bg-white rounded-lg shadow-[0_4px_12px_rgba(0,0,0,0.08)] p-6 text-center">
            <div className="w-16 h-16 bg-[#d1fae5] rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-8 h-8 text-[#16a34a]" />
            </div>
            <h1 className="text-[22px] font-bold text-[#1f2328] mb-2">
              Аккаунт создан!
            </h1>
            <p className="text-sm text-[#6b7280]">
              Перенаправление на страницу входа...
            </p>
          </div>
        </div>
      </div>
    );
  }

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
            Принять приглашение
          </h1>
          <p className="text-sm text-[#6b7280] text-center mb-2">
            Вас пригласил(а){" "}
            <span className="font-medium text-[#1f2328]">
              {invitation?.invitedByName}
            </span>
          </p>
          <div className="flex justify-center mb-6">
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-[#e0e7ff] text-[#3730a3]">
              {roleLabels[invitation?.role || "sales"]}
            </span>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email (readonly) */}
            <div>
              <label className="block text-xs font-semibold text-[#1f2328] mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={invitation?.email || ""}
                readOnly
                className="w-full h-10 px-3 text-sm bg-[#f4f5f7] border border-[#e3e6eb] rounded-md text-[#6b7280]"
              />
            </div>

            {/* Name */}
            <div>
              <label className="block text-xs font-semibold text-[#1f2328] mb-1.5">
                Ваше имя
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Иван Иванов"
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
                  placeholder="Минимум 6 символов"
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

            {/* Confirm Password */}
            <div>
              <label className="block text-xs font-semibold text-[#1f2328] mb-1.5">
                Подтвердите пароль
              </label>
              <input
                type={showPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Повторите пароль"
                className="w-full h-10 px-3 text-sm border border-[#e3e6eb] rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563eb] focus:border-transparent"
                required
              />
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
                  <UserPlus className="w-4 h-4" />
                  Создать аккаунт
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function AcceptPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-[#f4f5f7]">
          <span className="w-8 h-8 border-2 border-[#2563eb]/30 border-t-[#2563eb] rounded-full animate-spin" />
        </div>
      }
    >
      <AcceptContent />
    </Suspense>
  );
}
