-- Add FLUX (Black Forest Labs) provider + AI Creative image module
ALTER TYPE "AiProviderType" ADD VALUE IF NOT EXISTS 'FLUX';
ALTER TYPE "AiModuleKey" ADD VALUE IF NOT EXISTS 'AI_CREATIVE_IMAGE';
