"use client";

import { useCallback, useEffect, useRef } from "react";
import { useGetEventsInfinite } from "../../../../api/analytics/events/useGetEvents";
import { NothingFound } from "../../../../components/NothingFound";
import { formatter } from "../../../../lib/utils";
import { EventLogItem, EventLogItemSkeleton } from "./EventLogItem";

export function EventLog() {
  const containerRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Fetch events with infinite scrolling
  const {
    data,
    isLoading,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useGetEventsInfinite({
    pageSize: 100,
  });

  // Remove console.log

  // Handle scroll for infinite loading
  const handleScroll = useCallback(() => {
    if (
      !loadMoreRef.current ||
      !containerRef.current ||
      !hasNextPage ||
      isFetchingNextPage
    ) {
      return;
    }

    const container = containerRef.current;
    const loadMoreElement = loadMoreRef.current;
    const containerRect = container.getBoundingClientRect();
    const loadMoreRect = loadMoreElement.getBoundingClientRect();

    // Check if the load more element is visible in the viewport
    if (loadMoreRect.top <= containerRect.bottom + 100) {
      fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  // Set up scroll event listener
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener("scroll", handleScroll);
    return () => {
      container.removeEventListener("scroll", handleScroll);
    };
  }, [handleScroll]);

  // Flatten all pages of data
  const allEvents = data?.pages.flatMap((page) => page.data) || [];

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 100 }).map((_, index) => (
          <EventLogItemSkeleton key={index} />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="text-center py-8 text-neutral-400">
        Error loading events. Please try again.
      </div>
    );
  }

  if (allEvents.length === 0) {
    return (
      <NothingFound
        title={"No events found"}
        description={"Try a different date range or filter"}
      />
    );
  }

  return (
    <div className="space-y-1">
      {/* Event list */}
      <div ref={containerRef} className="max-h-[80vh] overflow-y-auto pr-2">
        {allEvents.map((event, index) => (
          <div
            key={`${event.timestamp}-${index}`}
            className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-md"
          >
            <EventLogItem event={event} />
          </div>
        ))}

        {/* Loading state for next page */}
        {hasNextPage && (
          <div className="py-2">
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                key={`next-page-${index}`}
                className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-md"
              >
                <EventLogItemSkeleton />
              </div>
            ))}
          </div>
        )}

        {/* Invisible element for scroll detection */}
        {hasNextPage && <div ref={loadMoreRef} className="h-1" />}
      </div>
      {/* Pagination info */}
      {data?.pages[0]?.pagination && (
        <div className="text-center text-xs text-neutral-400 pt-2">
          Showing {allEvents.length} of{" "}
          {formatter(data.pages[0].pagination.total)} events
        </div>
      )}
    </div>
  );
}
