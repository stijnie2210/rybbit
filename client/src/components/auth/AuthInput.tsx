"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ReactNode } from "react";

interface AuthInputProps {
  id: string;
  label: string;
  type: string;
  placeholder: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  required?: boolean;
  className?: string;
  rightElement?: ReactNode;
}

export function AuthInput({
  id,
  label,
  type,
  placeholder,
  value,
  onChange,
  required = false,
  className = "",
  rightElement,
}: AuthInputProps) {
  return (
    <div className={`grid gap-2 ${className}`}>
      <div className="flex justify-between items-center">
        <Label htmlFor={id}>{label}</Label>
        {rightElement && <div>{rightElement}</div>}
      </div>
      <Input
        id={id}
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        required={required}
        className="h-10 transition-all bg-white dark:bg-neutral-800/50 border-neutral-300 dark:border-neutral-700 text-neutral-900 dark:text-neutral-100"
        minLength={type === "password" ? 8 : undefined}
      />
    </div>
  );
}
