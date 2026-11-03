"use client";

import React, { useState, useEffect } from "react";
import { buildAssistantEndpoint } from "@/utils/auth-guard";
import Link from "next/link";

type Task = {
  id: string;
  title: string;
  status: "open" | "in-progress" | "done" | "cancelled";
  due?: string | null;
  source: "provider" | "local";
  providerName?: string | null;
};

export default function TasksWidget() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchTasks = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const endpoint = buildAssistantEndpoint("/assistant/tasks");
        const response = await fetch(endpoint, {
          credentials: "include",
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        setTasks(Array.isArray(data) ? data : []);
      } catch (err: any) {
        console.error("[TasksWidget] Failed to fetch tasks", err);
        setError(err?.message || "Failed to load tasks");
      } finally {
        setIsLoading(false);
      }
    };

    fetchTasks();
  }, []);

  const openTasks = tasks.filter((t) => t.status !== "done");
  const dueToday = openTasks.filter((task) => {
    if (!task.due) return false;
    try {
      const dueDate = new Date(task.due);
      const today = new Date();
      return (
        dueDate.getDate() === today.getDate() &&
        dueDate.getMonth() === today.getMonth() &&
        dueDate.getFullYear() === today.getFullYear()
      );
    } catch {
      return false;
    }
  });

  if (isLoading) {
    return (
      <div
        style={{
          background: `
            linear-gradient(180deg, 
              color-mix(in srgb, var(--panel) 85%, transparent) 0%, 
              color-mix(in srgb, var(--panel) 80%, transparent) 100%
            )
          `,
          backdropFilter: "blur(24px) saturate(160%)",
          WebkitBackdropFilter: "blur(24px) saturate(160%)",
          borderRadius: "18px",
          padding: "24px",
        }}
      >
        <div
          style={{
            fontSize: "0.6875rem",
            fontWeight: "500",
            color: "var(--text-faint)",
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            marginBottom: "12px",
          }}
        >
          Tasks
        </div>
        <div style={{ fontSize: "0.8125rem", color: "var(--text-subtle)" }}>
          Loading...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          background: `
            linear-gradient(180deg, 
              color-mix(in srgb, var(--panel) 85%, transparent) 0%, 
              color-mix(in srgb, var(--panel) 80%, transparent) 100%
            )
          `,
          backdropFilter: "blur(24px) saturate(160%)",
          WebkitBackdropFilter: "blur(24px) saturate(160%)",
          borderRadius: "18px",
          padding: "24px",
        }}
      >
        <div
          style={{
            fontSize: "0.6875rem",
            fontWeight: "500",
            color: "var(--text-faint)",
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            marginBottom: "12px",
          }}
        >
          Tasks
        </div>
        <div style={{ fontSize: "0.8125rem", color: "var(--error)" }}>
          {error}
        </div>
      </div>
    );
  }

  return (
    <Link
      href="/workspace/work/tasks"
      style={{
        textDecoration: "none",
        color: "inherit",
        display: "block",
      }}
    >
      <div
        style={{
          background: `
            linear-gradient(180deg, 
              color-mix(in srgb, var(--panel) 85%, transparent) 0%, 
              color-mix(in srgb, var(--panel) 80%, transparent) 100%
            )
          `,
          backdropFilter: "blur(24px) saturate(160%)",
          WebkitBackdropFilter: "blur(24px) saturate(160%)",
          borderRadius: "18px",
          padding: "24px",
          transition: "all 240ms cubic-bezier(0.4, 0, 0.2, 1)",
          position: "relative",
          cursor: "pointer",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = `
            linear-gradient(180deg, 
              color-mix(in srgb, var(--panel) 90%, transparent) 0%, 
              color-mix(in srgb, var(--panel) 85%, transparent) 100%
            )
          `;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = `
            linear-gradient(180deg, 
              color-mix(in srgb, var(--panel) 85%, transparent) 0%, 
              color-mix(in srgb, var(--panel) 80%, transparent) 100%
            )
          `;
        }}
      >
        <div
          style={{
            fontSize: "0.6875rem",
            fontWeight: "500",
            color: "var(--text-faint)",
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            marginBottom: "12px",
          }}
        >
          Tasks
        </div>
        <div
          style={{
            fontSize: "2rem",
            fontWeight: "600",
            color: "var(--text)",
            letterSpacing: "-0.03em",
            lineHeight: "1.1",
            marginBottom: "8px",
          }}
        >
          {openTasks.length}
        </div>
        <div
          style={{
            fontSize: "0.8125rem",
            color: "var(--text-subtle)",
            fontWeight: "400",
            lineHeight: "1.5",
            marginBottom: "12px",
          }}
        >
          {dueToday.length > 0
            ? `${dueToday.length} due today`
            : openTasks.length === 0
              ? "All tasks completed"
              : "Open tasks"}
        </div>
        {openTasks.length > 0 && (
          <div
            style={{
              marginTop: "16px",
              paddingTop: "16px",
              borderTop: "1px solid color-mix(in srgb, var(--text) 6%, transparent)",
            }}
          >
            <div
              style={{
                fontSize: "0.75rem",
                color: "var(--text-subtle)",
                fontWeight: "500",
                marginBottom: "8px",
              }}
            >
              Recent:
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {openTasks.slice(0, 3).map((task) => (
                <div
                  key={task.id}
                  style={{
                    fontSize: "0.8125rem",
                    color: "var(--text)",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  <span
                    style={{
                      width: "6px",
                      height: "6px",
                      borderRadius: "50%",
                      background: "var(--accent)",
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      flex: 1,
                    }}
                  >
                    {task.title}
                  </span>
                  {task.providerName && (
                    <span
                      style={{
                        fontSize: "0.6875rem",
                        padding: "2px 6px",
                        background: "var(--accent-bg, rgba(var(--accent-rgb), 0.1))",
                        color: "var(--accent)",
                        borderRadius: "4px",
                        textTransform: "capitalize",
                        flexShrink: 0,
                      }}
                    >
                      {task.providerName}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Link>
  );
}


