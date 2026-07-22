-- AI RAG: enable pgvector and add HNSW index for semantic search
CREATE EXTENSION IF NOT EXISTS vector;

-- Prisma creates tables via db push / migrate; this adds the native vector column
-- and index used by VectorSearchService (mirrors Float[] embedding in Prisma).
-- Safe on empty DBs: skip entirely when KbChunk does not exist yet.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'KbChunk'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'KbChunk'
        AND column_name = 'embedding_vec'
    ) THEN
      ALTER TABLE "KbChunk" ADD COLUMN embedding_vec vector(768);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = 'kb_chunk_embedding_vec_hnsw_idx'
    ) THEN
      CREATE INDEX kb_chunk_embedding_vec_hnsw_idx
        ON "KbChunk"
        USING hnsw (embedding_vec vector_cosine_ops)
        WHERE embedding_vec IS NOT NULL;
    END IF;
  END IF;
END $$;
