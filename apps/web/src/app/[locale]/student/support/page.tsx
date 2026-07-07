"use client";

import { Badge, Button, Card, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { SkeletonRows, useToast } from "@/components/overlay";
import { useT } from "@/i18n/client";
import { useCallback, useEffect, useState } from "react";

type Complaint = {
  id: string;
  subject: string;
  description: string;
  status: string;
  resolution: string | null;
  createdAt: string;
  teacher: { user: { fullLegalName: string | null } } | null;
};

type Teacher = { id: string; user: { fullLegalName: string | null } };

export default function StudentSupportPage() {
  const t = useT();
  const { toast } = useToast();
  const [complaints, setComplaints] = useState<Complaint[] | null>(null);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [rating, setRating] = useState(0);
  const [ratingComment, setRatingComment] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(() => {
    fetch("/api/complaints")
      .then((r) => (r.ok ? r.json() : { complaints: [] }))
      .then((d) => setComplaints(d.complaints || []));
    fetch("/api/teachers")
      .then((r) => (r.ok ? r.json() : { teachers: [] }))
      .then((d) => setTeachers(d.teachers || []))
      .catch(() => {});
  }, []);

  useEffect(load, [load]);

  async function submitComplaint(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    const res = await fetch("/api/complaints", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject, description, teacherId: teacherId || undefined }),
    });
    setSending(false);
    if (res.ok) {
      toast(t.student.complaintSubmitted);
      setSubject("");
      setDescription("");
      setTeacherId("");
      load();
    } else {
      toast("Failed", "error");
    }
  }

  async function submitRating(e: React.FormEvent) {
    e.preventDefault();
    if (!teacherId || !rating) return;
    const res = await fetch(`/api/teachers/${teacherId}/ratings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating, comment: ratingComment || undefined }),
    });
    if (res.ok) {
      toast(t.student.ratingSubmitted);
      setRating(0);
      setRatingComment("");
    } else {
      toast("Failed", "error");
    }
  }

  return (
    <div>
      <PageHeader title={t.student.supportTitle} description={t.student.supportDescription} />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Rate a teacher */}
        <Card>
          <h2 className="mb-4 font-semibold">{t.student.rateTeacher}</h2>
          <form onSubmit={submitRating} className="space-y-4">
            <Select
              label={t.student.teacher}
              value={teacherId}
              onChange={(e) => setTeacherId(e.target.value)}
              required
            >
              <option value="">—</option>
              {teachers.map((th) => (
                <option key={th.id} value={th.id}>
                  {th.user.fullLegalName}
                </option>
              ))}
            </Select>
            <div>
              <span className="label">{t.student.yourRating}</span>
              <div className="flex gap-1 text-2xl">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setRating(n)}
                    className={n <= rating ? "text-warning" : "text-muted/40"}
                    aria-label={`${n} stars`}
                  >
                    ★
                  </button>
                ))}
              </div>
            </div>
            <Input
              label={`${t.student.comment} (${t.student.optional})`}
              value={ratingComment}
              onChange={(e) => setRatingComment(e.target.value)}
            />
            <Button type="submit" disabled={!teacherId || !rating}>
              {t.student.submitRating}
            </Button>
          </form>
        </Card>

        {/* File a complaint */}
        <Card>
          <h2 className="mb-4 font-semibold">{t.student.fileComplaint}</h2>
          <form onSubmit={submitComplaint} className="space-y-4">
            <Input
              label={t.student.complaintSubject}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              required
            />
            <Select
              label={`${t.student.teacher} (${t.student.optional})`}
              value={teacherId}
              onChange={(e) => setTeacherId(e.target.value)}
            >
              <option value="">—</option>
              {teachers.map((th) => (
                <option key={th.id} value={th.id}>
                  {th.user.fullLegalName}
                </option>
              ))}
            </Select>
            <Textarea
              label={t.student.complaintDetails}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
            />
            <Button type="submit" disabled={sending}>
              {sending ? t.common.loading : t.student.submitComplaint}
            </Button>
          </form>
        </Card>
      </div>

      {/* My complaints */}
      <h2 className="mb-4 mt-8 font-semibold">{t.student.myComplaints}</h2>
      {complaints === null ? (
        <SkeletonRows rows={2} />
      ) : complaints.length === 0 ? (
        <p className="text-sm text-muted">{t.student.noComplaints}</p>
      ) : (
        <div className="stagger space-y-3">
          {complaints.map((c) => (
            <Card key={c.id}>
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium">{c.subject}</p>
                <Badge status={c.status === "RESOLVED" ? "APPROVED" : c.status === "OPEN" ? "PENDING" : "SUSPENDED"}>
                  {c.status}
                </Badge>
              </div>
              <p className="mt-2 text-sm text-muted">{c.description}</p>
              {c.resolution && (
                <p className="mt-3 rounded-lg bg-accent/10 p-3 text-sm">
                  <span className="font-semibold text-accent">{t.student.resolution}: </span>
                  {c.resolution}
                </p>
              )}
              <p className="mt-2 text-xs text-muted">{new Date(c.createdAt).toLocaleString()}</p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
