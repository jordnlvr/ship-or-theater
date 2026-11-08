declare module "*.mjs" {
  export function parseGalleryArgs(argv?: string[]): {
    only: string | undefined;
    concurrency: number;
    force: boolean;
    model: string;
    provider: string;
  };

  export function runGallery(options?: Record<string, unknown>): Promise<{
    succeeded: string[];
    skipped: string[];
    failed: Array<{ slug: string; error: string }>;
    indexEntries: unknown[];
  }>;
}
