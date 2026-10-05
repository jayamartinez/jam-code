-- The Git branch a provider conversation last worked on, as the provider
-- reported it: display data, and how JAM tells a finished chat (its branch
-- merged or deleted) when bringing it into a project.
ALTER TABLE provider_history ADD COLUMN branch TEXT;
