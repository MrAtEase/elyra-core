export type SupabaseRow = Record<string, unknown>;

type SupabaseTableShape = {
  Row: SupabaseRow;
  Insert: SupabaseRow;
  Update: SupabaseRow;
  Relationships: never[];
};

type SupabaseSchema = {
  Tables: Record<string, SupabaseTableShape>;
  Views: Record<string, never>;
  Functions: Record<string, never>;
  Enums: Record<string, string>;
  CompositeTypes: Record<string, never>;
};

// Central fallback Database typing used by all Supabase clients.
// Replace with generated DB types when available.
export type Database = {
  public: SupabaseSchema;
};

export type PublicSchemaName = keyof Database & string;
