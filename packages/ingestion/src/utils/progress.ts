export class ProgressTracker {
  private startTime: number | null = null;
  private currentCount: number = 0;

  public start(): void {
    this.startTime = Date.now();
  }

  public update(count: number): void {
    this.currentCount = count;
  }

  public getEventsPerSecond(): number {
    if (!this.startTime) return 0;
    
    const elapsedMs = Date.now() - this.startTime;
    if (elapsedMs === 0) return 0; // prevent divide by zero
    
    return Math.floor((this.currentCount / elapsedMs) * 1000);
  }

  public getETA(totalEvents: number): number {
    const eps = this.getEventsPerSecond();
    if (eps === 0) return 0;
    if (this.currentCount >= totalEvents) return 0;
    
    const remainingEvents = totalEvents - this.currentCount;
    return Math.ceil(remainingEvents / eps);
  }

  public getSummary(totalEvents?: number): string {
    const formatNumber = (n: number) => n.toLocaleString();
    
    let summary = `Ingested: ${formatNumber(this.currentCount)} | ` +
                  `Throughput: ${formatNumber(this.getEventsPerSecond())} events/sec`;
    
    if (totalEvents) {
      const eta = this.getETA(totalEvents);
      summary += ` | ETA: ${eta}s`;
    }
    
    return summary;
  }
}
