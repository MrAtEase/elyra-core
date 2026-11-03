-- Fix Fish-Delish workspace type to company.
UPDATE workspaces
SET type = 'company'
WHERE id = '013f1960-2edb-45fe-876a-d7b1b216b3f0'
  AND slug = 'fish-delish-workspace';
