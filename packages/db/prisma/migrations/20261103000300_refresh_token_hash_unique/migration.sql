DROP INDEX "refresh_tokens_token_hash_idx";
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");
