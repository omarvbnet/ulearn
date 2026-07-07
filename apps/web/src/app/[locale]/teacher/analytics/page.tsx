"use client";

import { Card, PageHeader, StatCard } from "@/components/ui";
import { SkeletonRows } from "@/components/overlay";
import { useEffect, useState } from "react";

type Analytics = {
  stats: {
    studentCount: number;
    courseCount: number;
    complaintCount: number;
    avgRating: number;
    ratings: { rating: number }[];
  };
  openQuestions: number;
  answeredByMe: number;
};

export default function TeacherAnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null);

  useEffect(() => {
    fetch("/api/teacher/analytics").then(async (r) => {
      if (r.ok) setData(await r.json());
    });
  }, []);

  return (
    <div>
      <PageHeader title="Analytics" description="Performance insights for your courses" />

      {data === null ? (
        <SkeletonRows rows={4} />
      ) : (
        <div className="space-y-6">
          <div className="stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Active Students" value={data.stats.studentCount} />
            <StatCard label="Assigned Subjects" value={data.stats.courseCount} />
            <StatCard
              label="Average Rating"
              value={data.stats.avgRating ? data.stats.avgRating.toFixed(1) : "—"}
              hint={`${data.stats.ratings.length} ratings`}
            />
            <StatCard label="Complaints" value={data.stats.complaintCount} />
          </div>

          <div className="stagger grid gap-4 sm:grid-cols-2">
            <Card>
              <h3 className="font-semibold">Q&A Activity</h3>
              <div className="mt-4 flex items-end gap-8">
                <div>
                  <p className="text-3xl font-bold glow-text">{data.openQuestions}</p>
                  <p className="mt-1 text-sm text-muted">Open questions waiting</p>
                </div>
                <div>
                  <p className="text-3xl font-bold text-success">{data.answeredByMe}</p>
                  <p className="mt-1 text-sm text-muted">Answers you posted</p>
                </div>
              </div>
            </Card>

            <Card>
              <h3 className="font-semibold">Ratings Breakdown</h3>
              {data.stats.ratings.length === 0 ? (
                <p className="mt-3 text-sm text-muted">No ratings yet.</p>
              ) : (
                <div className="mt-4 space-y-2">
                  {[5, 4, 3, 2, 1].map((star) => {
                    const count = data.stats.ratings.filter((r) => Math.round(r.rating) === star).length;
                    const pct = (count / data.stats.ratings.length) * 100;
                    return (
                      <div key={star} className="flex items-center gap-3 text-sm">
                        <span className="w-8 text-muted">{star}★</span>
                        <div className="progress-bar flex-1">
                          <div style={{ width: `${pct}%` }} />
                        </div>
                        <span className="w-8 text-end text-muted">{count}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
