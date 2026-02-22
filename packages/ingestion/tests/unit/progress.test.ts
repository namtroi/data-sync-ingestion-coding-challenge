import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProgressTracker } from '../../src/utils/progress';

describe('ProgressTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('records start time on start()', () => {
    const tracker = new ProgressTracker();
    tracker.start();
    expect(tracker.getEventsPerSecond()).toBe(0);
  });

  it('calculates throughput correctly', () => {
    const tracker = new ProgressTracker();
    tracker.start();
    
    // Advance 2 seconds
    vi.advanceTimersByTime(2000);
    tracker.update(2000); // 2000 events in 2 seconds = 1000/s
    
    expect(tracker.getEventsPerSecond()).toBe(1000);
  });

  it('estimates remaining time correctly', () => {
    const tracker = new ProgressTracker();
    tracker.start();
    
    vi.advanceTimersByTime(5000);
    tracker.update(5000); // 1000/s
    
    // Total 10000, current 5000, 5000 remaining at 1000/s = 5s
    const eta = tracker.getETA(10000);
    expect(eta).toBe(5);
  });

  it('returns 0 ETA if complete or impossible', () => {
    const tracker = new ProgressTracker();
    tracker.start();
    expect(tracker.getETA(100)).toBe(0); // no throughput yet
    
    vi.advanceTimersByTime(1000);
    tracker.update(200);
    
    expect(tracker.getETA(100)).toBe(0); // already passed total
  });

  it('formats progress string correctly', () => {
    const tracker = new ProgressTracker();
    tracker.start();
    
    vi.advanceTimersByTime(10000); // 10s
    tracker.update(50000); // 5000 req/s
    
    // 100000 total -> 50000 remaining @ 5000/s = 10s ETA
    const summary = tracker.getSummary(100000);
    expect(summary).toMatch(/Ingested: 50,000/);
    expect(summary).toMatch(/Throughput: 5,000 events\/sec/);
    expect(summary).toMatch(/ETA: 10s/);
  });
});
