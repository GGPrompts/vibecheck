"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import { Search, Loader2, Globe, GitCompareArrows, TrendingUp, Terminal, Box, Brain, Wrench } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { GitHubRepoCard } from "@/components/github/repo-card";

interface GitHubSearchResult {
  full_name: string;
  owner: string;
  repo: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  pushed_at: string;
}

const CATEGORIES = [
  { key: "trending", label: "Trending", icon: TrendingUp },
  { key: "cli", label: "CLI Tools", icon: Terminal },
  { key: "frameworks", label: "Frameworks", icon: Box },
  { key: "ai", label: "AI/ML", icon: Brain },
  { key: "devtools", label: "DevTools", icon: Wrench },
] as const;

type CategoryKey = (typeof CATEGORIES)[number]["key"];

/**
 * Detect whether the input looks like a GitHub URL or owner/repo pattern
 * rather than a generic search query.
 */
function isGitHubUrl(input: string): boolean {
  const trimmed = input.trim();
  if (trimmed.includes("github.com/")) return true;
  // Match "owner/repo" pattern (no spaces, exactly one slash, at least one char each side)
  if (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(trimmed)) return true;
  return false;
}

/**
 * Extract a full GitHub URL from the input. Handles raw URLs and owner/repo shorthand.
 */
function toGitHubUrl(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  // owner/repo shorthand
  return `https://github.com/${trimmed}`;
}

export default function ExplorePage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GitHubSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<CategoryKey | null>("trending");

  // Scan-via-URL state
  const [scanningUrl, setScanningUrl] = useState(false);
  const [_scanResult, setScanResult] = useState<{
    scanId: string;
    repoId: string;
    owner: string;
    repo: string;
  } | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchCategory = useCallback(async (category: CategoryKey) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    setResults([]);
    setScanResult(null);
    setSearched(false);

    try {
      const res = await fetch(
        `/api/github/trending?category=${encodeURIComponent(category)}`,
        { signal: controller.signal },
      );
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to load category");
        setSearched(true);
        return;
      }

      if (Array.isArray(data)) {
        setResults(data);
      }
      setSearched(true);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError("Failed to load category");
      setSearched(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Focus input and load trending on mount
  useEffect(() => {
    inputRef.current?.focus();
    fetchCategory("trending");
  }, [fetchCategory]);

  function handleCategoryClick(category: CategoryKey) {
    setActiveCategory(category);
    setQuery("");
    fetchCategory(category);
  }

  const handleSearch = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return;

      // Cancel any in-flight request
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setError(null);
      setActiveCategory(null);

      if (isGitHubUrl(trimmed)) {
        // Direct URL/owner-repo: trigger scan immediately
        setScanningUrl(true);
        setScanResult(null);
        setResults([]);
        setSearched(false);

        try {
          const repoUrl = toGitHubUrl(trimmed);
          const res = await fetch("/api/github/scan", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ repoUrl }),
            signal: controller.signal,
          });
          const data = await res.json();
          if (!res.ok) {
            setError(data.error || "Failed to start scan");
            setScanningUrl(false);
            return;
          }

          setScanResult({
            scanId: data.scanId,
            repoId: data.repoId,
            owner: data.owner,
            repo: data.repo,
          });

          // Also populate the search results with just this repo for the card UI
          setResults([
            {
              full_name: `${data.owner}/${data.repo}`,
              owner: data.owner,
              repo: data.repo,
              description: null,
              language: null,
              stargazers_count: 0,
              forks_count: 0,
              pushed_at: "",
            },
          ]);
          setSearched(true);
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setError("Failed to scan repository");
        } finally {
          setScanningUrl(false);
        }
      } else {
        // Search query
        setLoading(true);
        setScanResult(null);
        setResults([]);

        try {
          const res = await fetch(
            `/api/github/search?q=${encodeURIComponent(trimmed)}&limit=12`,
            { signal: controller.signal },
          );
          const data = await res.json();

          if (!res.ok) {
            setError(data.error || "Search failed");
            setSearched(true);
            return;
          }

          if (Array.isArray(data)) {
            setResults(data);
          }
          setSearched(true);
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setError("Search failed");
          setSearched(true);
        } finally {
          setLoading(false);
        }
      }
    },
    [],
  );

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      handleSearch(query);
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    // Auto-trigger scan on paste if it looks like a GitHub URL
    const pasted = e.clipboardData.getData("text");
    if (isGitHubUrl(pasted.trim())) {
      // Let the state update first, then trigger
      setTimeout(() => handleSearch(pasted.trim()), 0);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Explore</h1>
        <p className="text-muted-foreground">
          Search GitHub repositories or paste a URL to scan their health
        </p>
      </div>

      {/* Search bar */}
      <div className="flex items-center gap-3 max-w-2xl">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            placeholder="Search repos or paste a GitHub URL..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            className="h-10 pl-9 pr-4"
          />
          {(loading || scanningUrl) && (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>
        <Link
          href="/explore/compare"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 h-10 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors whitespace-nowrap shrink-0"
        >
          <GitCompareArrows className="h-4 w-4" />
          Compare
        </Link>
      </div>

      {/* Category pills */}
      <div className="flex items-center gap-2 flex-wrap">
        {CATEGORIES.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => handleCategoryClick(key)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
              activeCategory === key
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Scanning URL indicator */}
      {scanningUrl && (
        <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">
            Cloning and scanning repository...
          </span>
        </div>
      )}

      {/* Loading skeletons */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl ring-1 ring-foreground/10 p-4 space-y-3">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-1/2" />
              <div className="flex gap-3 pt-2">
                <Skeleton className="h-3 w-12" />
                <Skeleton className="h-3 w-12" />
                <Skeleton className="h-3 w-12" />
              </div>
              <Skeleton className="h-8 w-full mt-3" />
            </div>
          ))}
        </div>
      )}

      {/* Results grid */}
      {!loading && results.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {results.map((result) => (
            <GitHubRepoCard key={result.full_name} result={result} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && !scanningUrl && searched && results.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed p-12 text-center">
          <Globe className="h-10 w-10 text-muted-foreground/50 mb-3" />
          <p className="text-muted-foreground">
            No repositories found. Try a different search term.
          </p>
        </div>
      )}

      {/* Initial state — only shown if category fetch hasn't started yet */}
      {!loading && !scanningUrl && !searched && !error && !activeCategory && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed p-16 text-center">
          <Globe className="h-12 w-12 text-muted-foreground/30 mb-4" />
          <p className="text-lg font-medium text-muted-foreground">
            Discover open source repos
          </p>
          <p className="text-sm text-muted-foreground/70 mt-1 max-w-md">
            Search by name or topic, or paste a GitHub URL to instantly scan a
            repository&apos;s code health.
          </p>
        </div>
      )}
    </div>
  );
}
