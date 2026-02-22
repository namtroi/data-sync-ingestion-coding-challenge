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
    const limit = 5000;

    // 2. Fetch loop
    while (hasMore && !this.shouldStop) {
      // Fetch Page
      const page = await this.fetcher.fetchPage(limit, state.cursor);
      
      if (page.data.length > 0) {
        // Transform
        const rows = transformEvents(page.data);
        
        // Write
        await this.writer.add(rows);
        
        // Update State
        state.update(page.nextCursor, rows.length);
        
        // Save Cursor Checkpoint
        await saveCursor(this.pool, state);
        
        this.tracker.update(state.eventsIngested);
      }
      
      hasMore = page.hasMore;
      
      if (this.onProgressCallback) {
        // Total is not known dynamically, but 3M is the assignment total
        this.onProgressCallback(this.tracker.getSummary(3000000));
      }
    }

    // 3. Final flush
    await this.writer.close();
    
    // Final save in case write buffer was empty but cursor changed (rare)
    if (!this.shouldStop) {
        await saveCursor(this.pool, state);
    }
  }
}
