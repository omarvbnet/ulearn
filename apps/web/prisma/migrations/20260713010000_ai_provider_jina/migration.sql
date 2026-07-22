-- Add Jina AI provider type (embeddings / reranker)
ALTER TYPE "AiProviderType" ADD VALUE IF NOT EXISTS 'JINA';
