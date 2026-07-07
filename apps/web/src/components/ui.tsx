import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

export function Button({
  className,
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger" | "outline";
}) {
  const variants = {
    primary: "btn-primary",
    ghost: "rounded-xl px-4 py-2 text-muted hover:bg-white/5 hover:text-foreground",
    danger: "rounded-xl px-4 py-2 bg-danger/15 text-danger hover:bg-danger/25 font-semibold",
    outline:
      "rounded-xl px-4 py-2 border border-card-border text-foreground hover:border-accent/50 font-medium",
  };

  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer",
        variants[variant],
        className
      )}
      {...props}
    />
  );
}

export function Input({
  className,
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  return (
    <label className="block">
      {label && <span className="label">{label}</span>}
      <input className={cn("input", className)} {...props} />
    </label>
  );
}

export function Textarea({
  className,
  label,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string }) {
  return (
    <label className="block">
      {label && <span className="label">{label}</span>}
      <textarea className={cn("input min-h-24 resize-y", className)} {...props} />
    </label>
  );
}

export function Select({
  className,
  label,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      {label && <span className="label">{label}</span>}
      <select className={cn("input", className)} {...props}>
        {children}
      </select>
    </label>
  );
}

export function Card({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("card p-6", className)} {...props}>
      {children}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="stat-card">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-2 text-3xl font-bold glow-text">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function Badge({
  status,
  children,
}: {
  status: string;
  children: ReactNode;
}) {
  const cls =
    status === "PENDING"
      ? "badge-pending"
      : status === "APPROVED" || status === "ACTIVE"
        ? "badge-approved"
        : status === "FREE"
          ? "badge-free"
          : "badge-suspended";

  return <span className={cn("badge", cls)}>{children}</span>;
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
