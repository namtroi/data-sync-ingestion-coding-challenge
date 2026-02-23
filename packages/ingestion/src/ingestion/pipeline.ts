import { Fetcher } from '../api/fetcher.js';
import { DBWriter } from '../db/writer.js';
import { CursorState, loadCursor, saveCursor } from './cursor.js';
import { transformEvents } from './transformer.js';
import { ProgressTracker } from '../utils/progress.js';
import { Pool } from 'pg';

type ProgressCallback = (summary: string) => void;

export class Pipeline {
  private tracker = new ProgressTracker();
  private onProgressCallback?: ProgressCallback;
  private shouldStop = false;

  constructor(
    private fetcher: Fetcher,
    private writer: DBWriter,
    private pool: Pool
  ) {}

  public onProgress(cb: ProgressCallback) {
    this.onProgressCallback = cb;
  }

  public stop() {
    this.shouldStop = true;
  }

  public async run(): Promise<void> {
    this.tracker.start();
    
    // 1. Load cursor
    let state = await loadCursor(this.pool);
    if (!state) {
      state = CursorState.create();
    }
    
    this.tracker.update(state.eventsIngested);

    let hasMore = true;
    const limit = this.fetcher.isStreamMode ? 40000 : 5000;
    const useOverlap = this.fetcher.isStreamMode;

    try {
      if (useOverlap) {
        // Stream mode: overlap fetch + write (no rate limit)
        let pendingFetch = this.fetcher.fetchPage(limit, state.cursor);

        while (hasMore && !this.shouldStop) {
          const page = await pendingFetch;
          hasMore = page.hasMore;

          if (hasMore && !this.shouldStop) {
            pendingFetch = this.fetcher.fetchPage(limit, page.nextCursor);
          }

          if (page.data.length > 0) {
            const rows = transformEvents(page.data);
            await this.writer.add(rows);
            state.update(page.nextCursor, rows.length);
            this.tracker.update(state.eventsIngested);

            if (state.eventsIngested % 50000 < limit) {
              await saveCursor(this.pool, state);
            }
          }

          if (this.onProgressCallback) {
            this.onProgressCallback(this.tracker.getSummary(3000000));
          }
        }
      } else {
        // Standard mode: sequential with rate limit pacing
        const delayBetweenFetches = 6500;

        while (hasMore && !this.shouldStop) {
          const fetchStart = Date.now();
          const page = await this.fetcher.fetchPage(limit, state.cursor);
          hasMore = page.hasMore;

          if (page.data.length > 0) {
            const rows = transformEvents(page.data);
            await this.writer.add(rows);
            state.update(page.nextCursor, rows.length);
            this.tracker.update(state.eventsIngested);

            if (state.eventsIngested % 50000 < limit) {
              await saveCursor(this.pool, state);
            }
          }

          if (this.onProgressCallback) {
            this.onProgressCallback(this.tracker.getSummary(3000000));
          }

          if (hasMore && !this.shouldStop) {
            const elapsed = Date.now() - fetchStart;
            const waitTime = Math.max(0, delayBetweenFetches - elapsed);
            if (waitTime > 0) {
              await new Promise(r => setTimeout(r, waitTime));
            }
          }
        }
      }
    } catch (err: any) {
      // Save progress before exiting
      console.warn(`Pipeline interrupted: ${err.message}`);
      await this.writer.close();
      await saveCursor(this.pool, state);
      throw err;
    }

    // 3. Final flush
    await this.writer.close();
    await saveCursor(this.pool, state);
  }
}
