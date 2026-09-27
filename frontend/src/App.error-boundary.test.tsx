import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

// Keep providers/chrome light so the assertions are about routing + error
// containment only (same approach as App.routing.test.tsx).
vi.mock("./context/AuthContext", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => ({
    user: null,
    setUser: vi.fn(),
    isAuthenticated: false,
    isLoading: false,
    clearAuth: vi.fn(),
    login: vi.fn(),
  }),
}));
vi.mock("./context/NotificationContext", () => ({
  NotificationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("./components/Header", () => ({ default: () => null }));
vi.mock("./components/Toast", () => ({ default: () => null }));

// Represents a lazy page chunk that fails to evaluate — the shape of the #744
// bug: `import("./pages/NotFound")` resolving on a case-insensitive dev machine
// and failing on Linux/CI, which surfaced as a blank screen instead of a 404.
vi.mock("./pages/Dashboard", () => ({
  default: () => {
    throw new Error(
      "Failed to fetch dynamically imported module: /assets/Dashboard-abc123.js",
    );
  },
}));

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );

afterEach(() => {
  vi.restoreAllMocks();
});

describe("App route error handling (#744)", () => {
  it("renders the 404 page for an unknown path instead of a blank screen", async () => {
    renderAt("/definitely-not-a-route");

    expect(await screen.findByText("Page Not Found")).toBeInTheDocument();
    expect(screen.getByText("Error 404")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Back to Dashboard/i }),
    ).toBeInTheDocument();
  });

  it("contains a page that fails to load instead of blanking the app", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    renderAt("/");

    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
