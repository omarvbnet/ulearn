"use client";

import { Input, Select } from "@/components/ui";

type Props = {
  q: string;
  onQChange: (value: string) => void;
  visibility: string;
  onVisibilityChange: (value: string) => void;
  sort: string;
  onSortChange: (value: string) => void;
  sortOptions: { value: string; label: string }[];
  placeholder?: string;
};

export function AdminVideoFilters({
  q,
  onQChange,
  visibility,
  onVisibilityChange,
  sort,
  onSortChange,
  sortOptions,
  placeholder = "Search title, teacher, phone…",
}: Props) {
  return (
    <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto_auto]">
      <Input
        label="Search"
        value={q}
        onChange={(e) => onQChange(e.target.value)}
        placeholder={placeholder}
      />
      <Select label="Visibility" value={visibility} onChange={(e) => onVisibilityChange(e.target.value)}>
        <option value="visible">Visible</option>
        <option value="hidden">Hidden</option>
        <option value="deleted">Deleted</option>
        <option value="all">All</option>
      </Select>
      <Select label="Sort" value={sort} onChange={(e) => onSortChange(e.target.value)}>
        {sortOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
