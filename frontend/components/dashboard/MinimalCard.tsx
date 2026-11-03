"use client";

import { useState } from "react";

type MinimalCardProps = {
  title: string;
  children: React.ReactNode;
};

export default function MinimalCard({ title, children }: MinimalCardProps) {
  const [isOpen, setIsOpen] = useState(false);

  const handleToggle = () => {
    setIsOpen((prev) => !prev);
  };

  return (
    <div
      className="minimal-card"
      style={{
        border: "1px solid var(--border-subtle)",
        borderRadius: "16px",
        padding: "1rem",
        marginBottom: "1rem",
        background: "var(--panel-soft)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          cursor: "pointer",
        }}
        onClick={handleToggle}
      >
        <h2 style={{ margin: 0 }}>{title}</h2>
        <button
          style={{
            background: "var(--accent-soft)",
            border: "none",
            borderRadius: "8px",
            padding: "0.5rem 1rem",
            cursor: "pointer",
            color: "var(--accent-on)",
          }}
          onClick={handleToggle}
          aria-expanded={isOpen}
        >
          {isOpen ? "Close" : "Open"}
        </button>
      </div>
      {isOpen && (
        <div
          className="minimal-card__content"
          style={{
            marginTop: "1rem",
            paddingTop: "1rem",
            borderTop: "1px solid var(--border-subtle)",
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
